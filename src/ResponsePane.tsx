import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useTheme } from '@mui/material/styles';
import VirtualizedCodeView from './VirtualizedCodeView';
import CoverageData, { type CoverageView } from './CoverageData';
import LocationsData from './LocationsData';
import { summarizeCoverage } from './coverage/coverageSummary';
import { inheritedDomainType } from './coverage/inheritedDomainType';
import FetchErrorAlert from './FetchErrorAlert';
import ResponseChecks, { ChecksTabLabel } from './ResponseChecks';
import { findingMessage, findingPath } from './findingText';
import ResponseHeaders from './ResponseHeaders';
import ResponseSizes from './ResponseSizes';
import ResponseStatusLine from './ResponseStatusLine';
import { useRequestUrl } from './contexts/RequestUrlContext';
import { useCollection } from './contexts/CollectionContext';
import { usePublishResponseCells, useResponseCells } from './contexts/responseCells';
import { cellFindings } from './coverage/coverageCells';
import { mediaTypeFindings } from './coverage/mediaType';
import { locationsListOf } from './locations/locationsList';
import { locationsMediaTypeFindings } from './locations/mediaType';
import { isEdrGeojsonSchema } from './validation/locationsValidator';
import { schemaRuleOf } from './QueryResultValidator';
import { shortUrl } from './query/requestUrl';
import { collectionIdOf } from './query/requestLink';
import { checksCount, responseTabs, shownTab, type ResponseTab } from './responseTabs';
import type { ResponseDetails } from './api/sendRequest';
import type { ValidationError } from './DataRetrievalAPI';
import { useContentTypeDetection } from './hooks/useContentTypeDetection';
import { useXSLTTransform } from './hooks/useXSLTTransform';
import { useValidationErrorNavigation } from './hooks/useValidationErrorNavigation';
import { findLineForJsonPointer } from './utils/jsonPointerToLine';

interface ResponsePaneProps {
  // Whether the pane is showing: its keyboard shortcuts are only for then
  open: boolean;
  onClose: () => void;
  data: string | null;
  // For image/* responses: a blob: URL the pane renders via <img>. data stays null in that case.
  imageUrl?: string | null;
  contentType: string | null;
  // Null without a response (a network failure) and for a stored response, which wasn't sent just now
  response?: ResponseDetails | null;
  isLoading: boolean;
  error: string | null;
  // Sends the failed request again; only given when that may help
  onRetry?: () => void;
  url: string;
  validationErrors?: ValidationError[];
  validationSchemaName?: string | null;
  scrollToPath?: string;
}

const TAB_NAMES: Record<Exclude<ResponseTab, 'checks'>, string> = {
  data: 'Data',
  raw: 'Raw',
  headers: 'Headers',
  sizes: 'Sizes',
};

const ResponsePane: React.FC<ResponsePaneProps> = ({
  open,
  onClose,
  data,
  imageUrl = null,
  contentType,
  response = null,
  isLoading,
  error,
  onRetry,
  url,
  validationErrors = [],
  validationSchemaName = null,
  scrollToPath,
}) => {
  const theme = useTheme();
  // The request line above says what was sent, until it moves on or this isn't what it holds
  const { requestUrl } = useRequestUrl();
  const notTheRequestLine = url !== '' && url !== requestUrl;
  const isStored = response === null && data !== null;

  // Kept across sends, for the next response that has the tab
  const [preferredTab, setPreferredTab] = useState<ResponseTab | null>(null);
  const showRaw = useCallback(() => setPreferredTab('raw'), []);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedData, setCopiedData] = useState(false);
  const copyUrlTimer = useRef<ReturnType<typeof setTimeout>>();
  const copyDataTimer = useRef<ReturnType<typeof setTimeout>>();

  const {
    parsedJson, isIWXXM, language, shouldUseCodeView, formattedData,
  } = useContentTypeDetection(data, contentType);

  // The open collection's levels say which should be there, if the request is for that collection: a URL can be edited
  const { selectedCollection } = useCollection();
  const checkedAgainst = selectedCollection && url && collectionIdOf(url) === String(selectedCollection.id) ? selectedCollection : null;
  const vertical = checkedAgainst?.extent?.vertical;
  const temporal = checkedAgainst?.extent?.temporal;
  // A reader that throws is a fault in the app: the pane says so, and shows the response as data, rather than crash
  const { coverage, coverageFault } = useMemo(() => {
    try {
      return { coverage: summarizeCoverage(parsedJson, { url, vertical, temporal }), coverageFault: null };
    } catch (error) {
      console.error('summarizeCoverage failed on this response:', error);
      return { coverage: null, coverageFault: error instanceof Error ? error.message : String(error) };
    }
  }, [parsedJson, url, vertical, temporal]);
  const [coverageView, setCoverageView] = useState<CoverageView | null>(null);
  // A collection's locations, whatever the Content-Type says they are
  const locations = useMemo(() => locationsListOf(url, data, parsedJson)?.features ?? null, [url, data, parsedJson]);

  const tabs = responseTabs({
    hasResponse: response !== null && !isLoading,
    // A response the app failed to read opens there too, on the line that says so
    hasDataView: coverage !== null || coverageFault !== null || isIWXXM() || imageUrl !== null || locations !== null,
    hasImage: imageUrl !== null,
  });
  const tab = shownTab(preferredTab, tabs);

  const { transformedHtml, transformError, isTransforming } = useXSLTTransform(data, tab === 'data', isIWXXM, showRaw);

  // A line a note in Checks sent the reader to. Not a flagged line: a note isn't a fault in the response
  const [noteLine, setNoteLine] = useState<number | null>(null);

  // The map draws what this pane holds, and clears the moment a new request is sent
  const openInRaw = useCallback((pointer: string) => {
    setNoteLine(findLineForJsonPointer(formattedData, pointer));
    setPreferredTab('raw');
  }, [formattedData, setNoteLine, setPreferredTab]);
  usePublishResponseCells(isLoading ? null : parsedJson, url, openInRaw);

  // Closing and reopening the pane leaves it as it was
  useEffect(() => {
    setCopiedUrl(false);
    setCopiedData(false);
    setNoteLine(null);
  }, [data]);

  const {
    errorLineList, errorLines, gutterRanges,
    currentErrorIdx, currentError, scrollLine, handlePrevError, handleNextError, goToError,
  } = useValidationErrorNavigation(validationErrors, formattedData, contentType, scrollToPath, open && tab === 'raw');

  // Stepping through the flagged lines leaves the note's behind
  useEffect(() => setNoteLine(null), [currentErrorIdx]);

  const flaggedColor = checksCount(errorLineList.flatMap(entry => entry.errors))?.color ?? 'info';

  // What the picture found joins what the summary did. It leaves out what the summary says already: nulls and ranges
  const { reading } = useResponseCells();
  const coverageNotes = useMemo(() => [...(coverage?.notes ?? []), ...cellFindings(reading)], [coverage, reading]);
  // The media type of what's checked as CoverageJSON, or of a locations list. Checks is only there with the response's
  // details, and so its Content-Type
  const formatFindings = useMemo(
    () => (locations ? locationsMediaTypeFindings(contentType ?? '', isEdrGeojsonSchema(validationSchemaName))
      : validationSchemaName?.startsWith('CoverageJSON') ? mediaTypeFindings(contentType ?? '', parsedJson) : []),
    [locations, validationSchemaName, contentType, parsedJson],
  );
  const allFindings = useMemo(() => [...validationErrors, ...formatFindings, ...coverageNotes], [validationErrors, formatFindings, coverageNotes]);
  // Only when they're asked for: each is a walk through the whole of the text
  const showingChecks = tab === 'checks';
  const asNotes = useCallback((found: ValidationError[]) => found.map(note => ({
    message: note.message, severity: note.severity, source: note.source, rule: note.rule, line: note.path ? findLineForJsonPointer(formattedData, note.path) : undefined,
  })), [formattedData]);
  const dataNotes = useMemo(() => (showingChecks ? asNotes(coverageNotes) : []), [showingChecks, coverageNotes, asNotes]);
  const formatNotes = useMemo(() => (showingChecks ? asNotes(formatFindings) : []), [showingChecks, formatFindings, asNotes]);
  const markedLines = useMemo(() => (noteLine === null ? errorLines : new Set(errorLines).add(noteLine)), [errorLines, noteLine]);
  const modifier = navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl';

  const handleCopyData = useCallback(() => {
    if (!data) return;
    navigator.clipboard.writeText(data).then(() => {
      setCopiedData(true);
      clearTimeout(copyDataTimer.current);
      copyDataTimer.current = setTimeout(() => setCopiedData(false), 1500);
    }).catch(() => {
      // Clipboard write failed silently — no feedback shown
    });
  }, [data]);

  const handleCopyUrl = useCallback(() => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(true);
      clearTimeout(copyUrlTimer.current);
      copyUrlTimer.current = setTimeout(() => setCopiedUrl(false), 1500);
    }).catch(() => {
      // Clipboard write failed silently — no feedback shown
    });
  }, [url]);

  const copyBody = (
    <Tooltip title={copiedData ? "Copied!" : "Copy to clipboard"}>
      <IconButton size="small" aria-label="Copy the response" onClick={handleCopyData} color={copiedData ? "success" : "default"} sx={{ flexShrink: 0, mx: 0.5 }}>
        {copiedData ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, minHeight: 40, px: 1.5, py: 0.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {response ? (
            <ResponseStatusLine response={response} />
          ) : contentType ? (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              Content-Type: {contentType}
            </Typography>
          ) : !notTheRequestLine && (
            <Typography variant="subtitle2" component="div">Response</Typography>
          )}
          {notTheRequestLine && (
            <Typography variant="caption" noWrap title={url} sx={{ color: 'text.secondary', display: 'block' }}>
              {isStored ? '' : 'Sent: '}{shortUrl(url)}
            </Typography>
          )}
        </Box>
        {notTheRequestLine && (
          <Tooltip title={copiedUrl ? "Copied!" : "Copy URL"}>
            <IconButton
              size="small"
              aria-label="Copy URL"
              onClick={handleCopyUrl}
              color={copiedUrl ? "success" : "default"}
              sx={{ flexShrink: 0 }}
            >
              {copiedUrl ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Close (R)">
          <IconButton size="small" aria-label="Close the response pane" onClick={onClose} sx={{ flexShrink: 0 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!url && !isLoading && (
          <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
            Nothing sent yet. Choose a query and press Send, and its response shows here.
          </Typography>
        )}

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <CircularProgress />
          </Box>
        )}

        {error && <FetchErrorAlert message={error} onRetry={onRetry} />}

        {tabs.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Tabs
              value={tab}
              onChange={(_event, value: ResponseTab) => setPreferredTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="Ways to read this response"
              sx={{ flex: 1, minWidth: 0, minHeight: 36 }}
            >
              {tabs.map(name => (
                <Tab
                  key={name}
                  value={name}
                  label={name === 'checks' ? <ChecksTabLabel findings={allFindings} /> : TAB_NAMES[name]}
                  sx={{ minHeight: 36, minWidth: 0, px: 1.5, py: 0, textTransform: 'none' }}
                />
              ))}
            </Tabs>
            {tab === 'raw' && data && copyBody}
          </Box>
        )}

        {!isLoading && response && tab === 'headers' && <ResponseHeaders headers={response.headers} />}

        {!isLoading && response && tab === 'sizes' && <ResponseSizes response={response} />}

        {!isLoading && response && tab === 'checks' && (
          <ResponseChecks
            schemaName={validationSchemaName}
            schemaRule={schemaRuleOf(validationSchemaName)}
            checkedAs={validationSchemaName ? inheritedDomainType(parsedJson) : null}
            findings={validationErrors}
            lines={errorLineList}
            onGoToLine={index => {
              setNoteLine(null);
              goToError(index);
              setPreferredTab('raw');
            }}
            formatNotes={formatNotes}
            dataNotes={dataNotes}
            collectionId={checkedAgainst ? String(checkedAgainst.id) : null}
            url={url}
            onGoToNote={line => {
              setNoteLine(line);
              setPreferredTab('raw');
            }}
          />
        )}

        {!isLoading && tab === 'data' && imageUrl && (
          <Box sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'background.default',
            backgroundImage:
              'linear-gradient(45deg, rgba(127,127,127,0.15) 25%, transparent 25%),' +
              'linear-gradient(-45deg, rgba(127,127,127,0.15) 25%, transparent 25%),' +
              'linear-gradient(45deg, transparent 75%, rgba(127,127,127,0.15) 75%),' +
              'linear-gradient(-45deg, transparent 75%, rgba(127,127,127,0.15) 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
            p: 2,
          }}>
            <img
              src={imageUrl}
              alt="API response"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
              }}
            />
          </Box>
        )}

        {!isLoading && tab === 'data' && coverage && (
          <CoverageData summary={coverage} view={coverageView} onViewChange={setCoverageView} />
        )}

        {!isLoading && tab === 'data' && locations && <LocationsData features={locations} />}

        {!isLoading && tab === 'data' && coverageFault && (
          <Alert severity="error" sx={{ borderRadius: 0 }} action={<Button color="inherit" size="small" onClick={showRaw}>Show Raw</Button>}>
            The app failed to read this response as coverage data ({coverageFault}). That's a fault in the app, not a finding about the response. Raw has it as it came.
          </Alert>
        )}

        {!isLoading && tab === 'data' && data && !coverage && !coverageFault && !locations && (
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', backgroundColor: 'background.paper' }}>
            {transformedHtml && !isTransforming ? (
              <iframe
                srcDoc={transformedHtml}
                // The stylesheet's output from the API's XML: no scripts, and not the app's origin
                sandbox=""
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  display: 'block'
                }}
                title="IWXXM Preview"
              />
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <CircularProgress size={32} />
                <Typography variant="body2" sx={{ color: 'text.secondary', ml: 1.5 }}>
                  Transforming XSLT...
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {!isLoading && tab === 'raw' && response && !data && (
          <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
            The response has no body.
          </Typography>
        )}

        {!isLoading && tab === 'raw' && data && (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {(errorLineList.length > 0 || tabs.length === 0) && (
              <Box role="toolbar" aria-label="The response's text" sx={{
                px: 1,
                py: 0.25,
                backgroundColor: 'background.default',
                borderBottom: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 0.5,
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  {errorLineList.length > 0 && (
                    <>
                      <Chip
                        icon={<ErrorOutlineIcon />}
                        label={`${errorLineList.length} line${errorLineList.length === 1 ? '' : 's'} flagged`}
                        color={flaggedColor}
                        size="small"
                        variant="outlined"
                      />
                      <Tooltip title={`Previous flagged line (${modifier}+↑)`}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={handlePrevError}
                            disabled={currentErrorIdx <= 0}
                            aria-label="Previous flagged line"
                          >
                            <KeyboardArrowUpIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Typography variant="caption" sx={{ minWidth: 32, textAlign: 'center', userSelect: 'none' }}>
                        {currentErrorIdx + 1}/{errorLineList.length}
                      </Typography>
                      <Tooltip title={`Next flagged line (${modifier}+↓)`}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={handleNextError}
                            disabled={currentErrorIdx >= errorLineList.length - 1}
                            aria-label="Next flagged line"
                          >
                            <KeyboardArrowDownIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </>
                  )}
                </Box>
                {tabs.length === 0 && copyBody}
              </Box>
            )}

            {transformError && (
              <Alert severity="warning" sx={{ m: 1 }}>
                {transformError}
              </Alert>
            )}

            {currentError && (
              <Box sx={{
                px: 1.5,
                py: 0.75,
                backgroundColor: 'background.default',
                borderBottom: '1px solid',
                borderLeft: `3px solid ${theme.palette[flaggedColor].main}`,
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'baseline',
                gap: 1,
                flexWrap: 'wrap',
                minHeight: 32,
              }}>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'text.secondary', flexShrink: 0 }}>
                  L{currentError.line}
                </Typography>
                {currentError.errors.map((err, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                    {err.path && (
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'text.secondary' }}>
                        {findingPath(err)}
                      </Typography>
                    )}
                    {err.keyword && (
                      <Chip label={err.keyword} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 16 }} />
                    )}
                    <Typography variant="caption" sx={{ color: 'text.primary' }}>{findingMessage(err)}</Typography>
                  </Box>
                ))}
              </Box>
            )}

            <Box
              sx={{
                flex: 1,
                overflow: 'auto',
                p: 0,
                backgroundColor: 'background.paper',
              }}
            >
              {shouldUseCodeView ? (
                <VirtualizedCodeView
                  code={formattedData}
                  language={language}
                  isDark={theme.palette.mode === 'dark'}
                  errorLines={markedLines}
                  gutterRanges={gutterRanges}
                  errorColor={theme.palette[flaggedColor].main}
                  scrollToLine={noteLine ?? scrollLine}
                />
              ) : (
                <pre style={{
                  margin: 0,
                  padding: '16px',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  {formattedData}
                </pre>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ResponsePane;
