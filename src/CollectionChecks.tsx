import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import type { ReactNode } from 'react';
import CollectionValidationErrors from './CollectionValidationErrors';
import RuleLinks, { EdrVersionNote } from './RuleLinks';
import { hasMapsSupport } from './api/maps';
import { useCitedEdr } from './hooks/useCitedEdr';
import { collectionInfoLetter, EDR } from './standards';
import type { Citation, EdrRule } from './types/api';
import TemporalExtent from './TemporalExtent';
import VerticalExtent from './VerticalExtent';
import { Collection, ValidationResult, normalizeHref } from './DataRetrievalAPI';

// A field's title, with the statement it's checked against
const Title = ({ children, rule }: { children: ReactNode; rule?: Citation }) => (
  <AlertTitle>{children}{rule && <RuleLinks rule={rule} />}</AlertTitle>
);

// What's checked of a collection, each against its statement of /req/edr/rc-collection-info. A check is lettered and
// placed by that statement, in the EDR version cited, so its letter is always its rule's. A field with no statement
// there in that version (data_queries in 1.1, which its collections.yaml requires) has no letter, and comes last. The
// statements with no check here: 1.1 H and I, 1.2 I and J, a radius query's distance units
// Its title is given citing its rule, or plain where the check doesn't apply
interface Titles {
  cited: ReactNode;
  plain: ReactNode;
}
interface FieldCheck {
  name: string;
  rule: EdrRule;
  render: (title: Titles, letter: string | null) => ReactNode;
}

// The schema's rule a bbox's shape rests on: "The content of that response SHALL be based upon the schema
// collections.yaml"
const BBOX_RULE = EDR.collectionsSuccessB;

function checksOf(collection: Collection): FieldCheck[] {
  const maps = hasMapsSupport(collection);
  return [
    {
      name: 'ID',
      rule: EDR.collectionId,
      render: title => (typeof collection.id == 'undefined'
        ? <Alert severity="error">{title.cited}Every Collection within a collections array SHALL have a unique (within the array) id parameter.</Alert>
        : <Alert severity="success">{title.cited}{collection.id}</Alert>),
    },
    {
      name: 'TITLE',
      rule: EDR.collectionTitle,
      render: title => (typeof collection.title == 'undefined'
        ? <Alert severity="warning">{title.cited}Every Collection within a collections array SHOULD have a title parameter.</Alert>
        : <Alert severity="success">{title.cited}{collection.title}</Alert>),
    },
    {
      name: 'DESCRIPTION',
      rule: EDR.collectionDescription,
      render: title => (typeof collection.description == 'undefined'
        ? <Alert severity="warning">{title.cited}Every Collection within a collections array SHOULD have a description parameter.</Alert>
        : <Alert severity="success">{title.cited}{collection.description}</Alert>),
    },
    {
      name: 'KEYWORDS',
      rule: EDR.collectionKeywords,
      render: title => (typeof collection.keywords == 'undefined'
        ? <Alert severity="warning">{title.cited}Every Collection within a collections array SHOULD have a keywords parameter.</Alert>
        : <Alert severity="success">{title.cited}{collection.keywords.join(', ')}</Alert>),
    },
    {
      name: 'LINKS',
      rule: EDR.collectionLinks,
      render: title => (typeof collection.links == 'undefined'
        ? <Alert severity="error">{title.cited}Every Collection within a collections array SHALL have a links parameter.</Alert>
        : <Alert severity="success">{title.cited}{collection.links.map((link, i) => {
          const normalizedHref = normalizeHref(link.href);
          return normalizedHref ? (<div key={i}><Link href={normalizedHref}>{link.title ? link.title : link.rel}</Link> ({link.rel})</div>) : null;
        })}</Alert>),
    },
    {
      name: 'EXTENT',
      rule: EDR.collectionExtent,
      render: (title, number) => extentChecks(collection, title, number),
    },
    {
      name: 'DATA_QUERIES',
      rule: EDR.collectionDataQueries,
      render: title => (typeof collection.data_queries == 'undefined'
        ? (maps
          ? <Alert severity="info">{title.plain}Not applicable — this collection is served via OGC API Maps, which uses link relations instead of data_queries.</Alert>
          : <Alert severity="error">{title.cited}Every collection within a collections array SHALL have a data_queries parameter.</Alert>)
        : (
          <Alert severity="success">
            {title.cited}
            {Object.keys(collection.data_queries).map((key) => {
              const normalizedHref = normalizeHref(collection.data_queries[key]?.link?.href);
              return normalizedHref ? (
                <div key={key}>
                  <Link href={normalizedHref}>
                    {collection.data_queries[key].link.title ? collection.data_queries[key].link.title : collection.data_queries[key].link.rel}
                  </Link> ({collection.data_queries[key].link.rel})
                </div>
              ) : null;
            })}
          </Alert>
        )),
    },
    {
      name: 'CRS',
      rule: EDR.collectionCrs,
      render: title => (typeof collection.crs == 'undefined'
        ? <Alert severity="error">{title.cited}Every collection within a collections array SHALL have a crs parameter.</Alert>
        : <Alert severity="success">{title.cited}{collection.crs}</Alert>),
    },
    {
      name: 'OUTPUT_FORMATS',
      rule: EDR.collectionOutputFormats,
      render: title => ((!collection.output_formats || !Array.isArray(collection.output_formats))
        ? (maps
          ? <Alert severity="info">{title.plain}Not applicable — OGC API Maps collections advertise image formats via conformance classes rather than output_formats.</Alert>
          : <Alert severity="error">{title.cited}Every collection within a collections array SHALL have an output_formats parameter.</Alert>)
        : <Alert severity="success">{title.cited}{collection.output_formats.join(', ')}</Alert>),
    },
    {
      name: 'PARAMETER_NAMES',
      rule: EDR.collectionParameterNames,
      render: title => (typeof collection.parameter_names == 'undefined'
        ? (maps
          ? <Alert severity="info">{title.plain}Not applicable — OGC API Maps collections do not declare parameter_names.</Alert>
          : <Alert severity="error">{title.cited}Every collection within a collections array SHALL have a parameter_names parameter.</Alert>)
        : (
          <Alert severity="success">
            {title.cited}
            {Array.isArray(collection.parameter_names)
              ? collection.parameter_names.map((param) => (
                <div key={param.id}>
                  {param.label || param.id} ({param.type || 'unknown'})
                </div>
              ))
              : Object.keys(collection.parameter_names).map((paramKey) => {
                const params = collection.parameter_names as { [key: string]: any };
                return (
                  <div key={paramKey}>
                    {params[paramKey]?.description || paramKey} ({params[paramKey]?.type || 'unknown'})
                  </div>
                );
              })
            }
          </Alert>
        )),
    },
  ];
}

// The extent, and its spatial, temporal and vertical parts numbered under its letter
function extentChecks(collection: Collection, title: Titles, number: string | null) {
  const part = (n: number, name: string) => (number ? `${number}.${n}: ${name}` : name);
  if (typeof collection.extent === 'undefined') {
    return (
      <Alert severity="error">
        {title.cited}
        Every collection within a collections array SHALL have an extent parameter.
      </Alert>
    );
  }
  const spatial = collection.extent.spatial;
  return (
    <Box sx={{ padding: 0, minWidth: 120 }}>
      <Alert severity="success">
        {title.cited}
        Collection extent information with spatial (mandatory), temporal and vertical components (optional).
      </Alert>

      {spatial && typeof spatial === 'object' && spatial.bbox && Array.isArray(spatial.bbox) && spatial.bbox.length > 0 && spatial.crs ? (
        <Box sx={{ ml: 2, mt: 1 }}>
          <Alert severity="success">
            <AlertTitle>{part(1, 'Spatial Extent (Mandatory)')}</AlertTitle>
            <strong>CRS:</strong> {spatial.crs}<br/>
            <strong>Bounding Box{Array.isArray(spatial.bbox[0]) && spatial.bbox.length > 1 ? 'es' : ''}:</strong><br/>
            {Array.isArray(spatial.bbox[0])
              ? (spatial.bbox as number[][]).map((bbox, idx) => (
                <div key={idx} style={{ marginLeft: '10px' }}>
                  Bbox {idx + 1}: [{bbox.join(', ')}]
                </div>
              ))
              : <div style={{ marginLeft: '10px' }}>[{(spatial.bbox as number[]).join(', ')}]</div>
            }
          </Alert>
          {/* The collections "SHALL be based upon the schema collections.yaml", which has an array of boxes: an error */}
          {!Array.isArray(spatial.bbox[0]) && (
            <Alert severity="error" sx={{ mt: 1 }}>
              <Title rule={BBOX_RULE}>Legacy bbox format</Title>
              This collection uses a flat array format instead of the EDR standard array-of-bbox-arrays format.
            </Alert>
          )}
        </Box>
      ) : (
        <Box sx={{ ml: 2, mt: 1 }}>
          <Alert severity="error">
            <AlertTitle>{part(1, 'Spatial Extent (Mandatory)')}</AlertTitle>
            Missing or invalid spatial extent. Spatial extent with bounding box and CRS is required.
          </Alert>
        </Box>
      )}

      <Box sx={{ ml: 2, mt: 1 }}>
        <TemporalExtent temporal={collection.extent.temporal} collectionId={collection.id} subsection={part(2, 'Temporal Extent (Optional)')} />
      </Box>

      {collection.extent?.vertical && (
        <Box sx={{ ml: 2, mt: 1 }}>
          <VerticalExtent vertical={collection.extent.vertical} collectionId={collection.id} subsection={part(3, 'Vertical Extent (Optional)')} />
        </Box>
      )}
    </Box>
  );
}

// A collection, checked against what the standard asks of it, field by field
export default function CollectionChecks({ collection, validationResult }: { collection: Collection; validationResult: ValidationResult }) {
  const { version } = useCitedEdr();
  const checks = checksOf(collection)
    .map(check => ({ check, letter: collectionInfoLetter(check.rule, version) }))
    // By letter, and those without one last, in the order above
    .sort((a, b) => (a.letter === b.letter ? 0 : a.letter === null ? 1 : b.letter === null ? -1 : a.letter < b.letter ? -1 : 1));
  return (
    <Box sx={{ p: 2 }}>
      <EdrVersionNote rules={[...checks.map(({ check }) => check.rule), BBOX_RULE]} />
      {/* Schema validation errors for this collection */}
      {validationResult.collectionErrors && validationResult.collectionErrors[collection.id] && (
        <CollectionValidationErrors
          collectionId={collection.id}
          errors={validationResult.collectionErrors[collection.id]}
          expanded={false}
        />
      )}
      {checks.map(({ check, letter }) => {
        const name = letter ? `${letter}: ${check.name}` : check.name;
        return <Box key={check.name}>{check.render({ cited: <Title rule={check.rule}>{name}</Title>, plain: <AlertTitle>{name}</AlertTitle> }, letter)}</Box>;
      })}
    </Box>
  );
}
