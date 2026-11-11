import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { COMMON1, EDR11, EDR12, FEATURES1, FEATURES2, MAPS1, RECORDS1 } from './standards';
import type { ValidationError } from './types/api';
import { publicUrl } from './utils/publicUrl';
import { appFault, isProblem } from './validation/severity';

// Schema type definitions
type SchemaType = 'edr-p1-v1.0' | 'edr-p1-v1.1' | 'edr-p1-v1.2' | 'features-p1-v1.0' | 'features-p2-v1.0' | 'common-p1-v1.0' | 'common-p2-v1.0' | 'records-p1-v1.0' | 'maps-p1-v1.0';

interface SchemaConfig {
  type: SchemaType;
  conformancePattern: string;
  displayName: string;
  schemas: {
    landingPage?: string;
    collections?: string;
    conformance?: string;
  };
  // The requirement each schema checks, where its standard's text has been read: "The content of that response SHALL
  // be based upon the [OpenAPI 3.0] schema landingPage.yaml" (confClasses.yaml, collections.yaml)
  rules?: {
    landingPage?: ValidationError['rule'];
    collections?: ValidationError['rule'];
    conformance?: ValidationError['rule'];
  };
  // A rule for some of a collections schema's findings, by where they are, in place of the schema's own
  pathRules?: { path: RegExp; rule: ValidationError['rule'] }[];
}

// Where in a collections list a dimension's extent is, other than space and time: /collections/0/extent/elevation/…
const ADDITIONAL_DIMENSION = /^\/collections\/\d+\/extent\/(?!spatial(?:\/|$)|temporal(?:\/|$))[^/]+/;

// Configuration for all supported schemas - using individual schema files
const SCHEMA_CONFIGS: SchemaConfig[] = [
  {
    type: 'features-p1-v1.0',
    conformancePattern: '/spec/ogcapi-features-1/1.0/conf/core',
    displayName: 'OGC API Features Part 1 v1.0',
    schemas: {
      landingPage: '/schemas/individual/features-p1-v1.0/landingPage.json',
      collections: '/schemas/individual/features-p1-v1.0/collections.json',
      conformance: '/schemas/individual/features-p1-v1.0/confClasses.json'
    },
    rules: { landingPage: FEATURES1.rootSuccessB, collections: FEATURES1.collectionsSuccessB, conformance: FEATURES1.conformanceSuccessB },
  },
  {
    type: 'features-p2-v1.0',
    conformancePattern: '/spec/ogcapi-features-2/1.0/conf/crs',
    displayName: 'OGC API Features Part 2 v1.0 (CRS)',
    schemas: {
      // Features Part 2 only defines CRS extensions for collections, no landing page or conformance
      collections: '/schemas/individual/features-p2-v1.0/collections.json'
    },
    // The schema checks the crs list's entries are URIs
    rules: { collections: FEATURES2.crsUri },
  },
  {
    type: 'edr-p1-v1.2',
    conformancePattern: '/spec/ogcapi-edr-1/1.2/conf/core',
    displayName: 'OGC API EDR Part 1 v1.2',
    schemas: {
      landingPage: '/schemas/individual/edr-p1-v1.2/landingPage.json',
      collections: '/schemas/individual/edr-p1-v1.2/collections.json',
      conformance: '/schemas/individual/edr-p1-v1.2/confClasses.json'
    },
    rules: { landingPage: EDR12.rootSuccessB, collections: EDR12.collectionsSuccessB, conformance: EDR12.conformanceSuccessB },
  },
  {
    type: 'edr-p1-v1.1',
    conformancePattern: '/spec/ogcapi-edr-1/1.1/conf/core',
    displayName: 'OGC API EDR Part 1 v1.1',
    schemas: {
      landingPage: '/schemas/individual/edr-p1-v1.1/landingPage.json',
      collections: '/schemas/individual/edr-p1-v1.1/collections.json',
      conformance: '/schemas/individual/edr-p1-v1.1/confClasses.json'
    },
    rules: { landingPage: EDR11.rootSuccessB, collections: EDR11.collectionsSuccessB, conformance: EDR11.conformanceSuccessB },
  },
  {
    type: 'edr-p1-v1.0',
    conformancePattern: '/spec/ogcapi-edr-1/1.0/conf/core',
    displayName: 'OGC API EDR Part 1 v1.0',
    schemas: {
      landingPage: '/schemas/individual/edr-p1-v1.0/landingPage.json',
      collections: '/schemas/individual/edr-p1-v1.0/collections.json',
      conformance: '/schemas/individual/edr-p1-v1.0/confClasses.json'
    },
    // EDR 1.0's text isn't cited: its requirements are cited as 1.1 words them
    rules: { landingPage: EDR11.rootSuccessB, collections: EDR11.collectionsSuccessB, conformance: EDR11.conformanceSuccessB },
  },
  {
    type: 'common-p1-v1.0',
    conformancePattern: '/spec/ogcapi-common-1/1.0/conf/core',
    displayName: 'OGC API Common Part 1: Core (v1.0)',
    schemas: {
      landingPage: '/schemas/individual/common-p1-v1.0/landingPage.json',
      conformance: '/schemas/individual/common-p1-v1.0/confClasses.json'
      // Note: Common doesn't define collections
    },
    rules: { landingPage: COMMON1.rootSuccessB, conformance: COMMON1.conformanceSuccessB },
  },
  {
    type: 'common-p2-v1.0',
    conformancePattern: '/spec/ogcapi-common-2/1.0/conf/collections',
    displayName: 'OGC API Common Part 2: Collections (v1.0)',
    schemas: {
      landingPage: '/schemas/individual/common-p2-v1.0/landingPage.json',
      conformance: '/schemas/individual/common-p2-v1.0/confClasses.json',
      collections: '/schemas/individual/common-p2-v1.0/collections.json'
    }
  },
  {
    type: 'records-p1-v1.0',
    conformancePattern: '/spec/ogcapi-records-1/1.0/conf/core',
    displayName: 'OGC API Records Part 1: Core (v1.0)',
    schemas: {
      landingPage: '/schemas/individual/records-p1-v1.0/landingPage.json',
      collections: '/schemas/individual/records-p1-v1.0/catalogs.json'
      // Note: Records doesn't have a conformance schema
    },
    // The landing page is Features Part 1's, which the records-api class requires; each catalog has Table 11's
    // properties, in the schema of /req/records-api/catalog-response
    rules: {
      landingPage: [RECORDS1.featuresApi, FEATURES1.rootSuccessB],
      collections: [RECORDS1.catalogsResponseB, RECORDS1.catalogProperties],
    },
  },
  {
    type: 'maps-p1-v1.0',
    conformancePattern: '/spec/ogcapi-maps-1/1.0/conf/core',
    displayName: 'OGC API Maps Part 1: Core (v1.0)',
    schemas: {
      landingPage: '/schemas/individual/maps-p1-v1.0/landingPage.json',
      collections: '/schemas/individual/maps-p1-v1.0/collections.json',
      conformance: '/schemas/individual/maps-p1-v1.0/confClasses.json'
    },
    // Maps names no schema of its own for these: the landing page and conformance shapes are Common Part 1's. Its
    // collections shape is Common Part 2's, a draft, uncited here, but for the extent of a dimension beyond space and
    // time, which is Maps' own, extent-uad.yaml
    rules: { landingPage: COMMON1.rootSuccessB, conformance: COMMON1.conformanceSuccessB },
    pathRules: [{ path: ADDITIONAL_DIMENSION, rule: MAPS1.additionalDimensions }],
  }
];

interface ValidatorSet {
  collections?: any;
  landingPage?: any;
  conformance?: any;
}

// EDR 1.2's text against OGC's schema for a data query's variables, which requires all of these. The text,
// /req/edr/rc-common-variables: B "A variables property MAY include a title property of type string", C "… MAY include
// an output_formats property which SHALL be a string array", D "… SHOULD include a default_output_format property of
// type string", F "… MAY include a crs_details property which SHALL be an array of objects", and nothing of a
// description. The text is followed over the schema: a MAY left out is a note, a SHOULD left out an issue
const VARIABLES_PATH = /^\/collections\/\d+\/data_queries\/[^/]+\/link\/variables$/;
const VARIABLES_TEXT: Record<string, { severity: 'info' | 'warning'; says: string; rule?: ValidationError['rule'] }> = {
  title: { severity: 'info', says: 'EDR 1.2 says a variables property MAY include one, where its schema requires it', rule: EDR12.variablesTitle },
  output_formats: { severity: 'info', says: 'EDR 1.2 says a variables property MAY include one, where its schema requires it', rule: EDR12.variablesOutputFormats },
  default_output_format: { severity: 'warning', says: 'EDR 1.2 says a variables property SHOULD include one', rule: EDR12.variablesDefaultOutputFormat },
  crs_details: { severity: 'info', says: 'EDR 1.2 says a variables property MAY include one, where its schema requires it', rule: EDR12.variablesCrsDetails },
  description: { severity: 'info', says: "EDR 1.2's text doesn't ask for one, where its schema requires it" },
};

// A schema's finding, with the schema it's of
type Found = ValidationError & { schemaType?: SchemaType };

// A schema error as the text rates it. Only EDR 1.2's collections schema asks more than its text
function asTheTextSays(error: Found, schemaType: SchemaType): Found {
  if (schemaType !== 'edr-p1-v1.2' || error.keyword !== 'required' || !VARIABLES_PATH.test(error.path ?? '')) return error;
  const missing = error.params?.missingProperty;
  const text = typeof missing === 'string' && Object.prototype.hasOwnProperty.call(VARIABLES_TEXT, missing) ? VARIABLES_TEXT[missing] : null;
  if (!text) return error;
  return { ...error, severity: text.severity, message: `${error.path}: no ${missing}. ${text.says}`, ...(text.rule ? { rule: text.rule } : {}) };
}

// A schema the API doesn't declare, used because it declares none the app has: its findings rest on a standard the
// server doesn't claim, so none is an error. Each is an issue, for the server to declare its classes or fix, and the
// schema's name says so
const UNDECLARED = ' (not declared: assumed)';
const asUndeclared = (error: Found): Found => (isProblem(error) ? { ...error, severity: 'warning' } : error);

// What the app says when it couldn't check at all: its own fault, not counted against the server
const NOTHING_LOADED = () => ({ valid: true, errors: [appFault('No schemas loaded. Validation skipped.')] });

interface SchemaSet {
  collections?: any;
  landingPage?: any;
  conformance?: any;
}

// This class handles validation against multiple OGC API individual schemas
export class SchemaValidator {
  private static instance: SchemaValidator;
  private loadedSchemas: Map<SchemaType, SchemaSet> = new Map();
  private validators: Map<SchemaType, ValidatorSet> = new Map();
  private schemaLoadError: string | null = null;
  // Whether the schemas loaded are a default, the API declaring none the app has
  private assumed = false;
  private ajv: Ajv;

  private constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
      validateFormats: true
    });
    addFormats(this.ajv);
  }

  public static getInstance(): SchemaValidator {
    if (!SchemaValidator.instance) {
      SchemaValidator.instance = new SchemaValidator();
    }
    return SchemaValidator.instance;
  }

  // The name a schema's results go under, which says when the API doesn't declare it
  private nameOf(displayName: string): string {
    return this.assumed ? `${displayName}${UNDECLARED}` : displayName;
  }

  // A schema's finding, which is no error where the API doesn't declare the schema
  private rated(error: Found): Found {
    return this.assumed ? asUndeclared(error) : error;
  }

  // A validator that threw: the app's own fault, which leaves the schema unchecked
  private couldNotCheck(displayName: string, error: unknown, extra: Pick<Found, 'schemaType'> = {}): Found {
    return { ...extra, ...appFault(`${displayName} could not be checked: ${error instanceof Error ? error.message : 'unknown error'}`, { schema: displayName }) };
  }

  /**
   * Detect and load all schemas that match the conformance classes
   * Clears previously loaded schemas to ensure only matching schemas are used
   */
  public async loadSchemaBasedOnConformance(conformsTo?: string[]): Promise<boolean> {
    if (!conformsTo || conformsTo.length === 0) {
      console.log('🎯 No conformance classes provided, defaulting to EDR Part 1 v1.1 schema');
      // Clear existing schemas before loading default
      this.loadedSchemas.clear();
      this.validators.clear();
      this.assumed = true;
      return this.loadSingleSchema('edr-p1-v1.1');
    }

    console.log(`🎯 Analyzing ${conformsTo.length} conformance classes...`);
    
    // Find all matching schemas
    const matchingSchemas: SchemaConfig[] = [];
    for (const config of SCHEMA_CONFIGS) {
      if (conformsTo.some(url => url.endsWith(config.conformancePattern))) {
        matchingSchemas.push(config);
        console.log(`   ✓ Found: ${config.displayName}`);
      }
    }

    if (matchingSchemas.length === 0) {
      console.log('🎯 No matching conformance classes found, defaulting to EDR Part 1 v1.1 schema');
      // Clear existing schemas before loading default
      this.loadedSchemas.clear();
      this.validators.clear();
      this.assumed = true;
      return this.loadSingleSchema('edr-p1-v1.1');
    }

    // Clear existing schemas to ensure only matching schemas are loaded
    console.log(`🧹 Clearing previously loaded schemas...`);
    this.loadedSchemas.clear();
    this.validators.clear();
    this.assumed = false;

    // Load all matching schemas
    console.log(`📥 Loading ${matchingSchemas.length} schema(s)...`);
    let allSuccess = true;
    
    for (const config of matchingSchemas) {
      const success = await this.loadSingleSchema(config.type);
      if (!success) {
        console.warn(`   ⚠️  Failed to load ${config.displayName}`);
        allSuccess = false;
      }
    }

    console.log(`✅ Schema loading complete. ${this.loadedSchemas.size} schema(s) ready for validation.`);
    return allSuccess;
  }

  /**
   * Load individual schema files for a specific schema type
   */
  private async loadSingleSchema(schemaType: SchemaType): Promise<boolean> {
    const config = SCHEMA_CONFIGS.find(c => c.type === schemaType);
    if (!config) {
      console.error(`❌ Unknown schema type: ${schemaType}`);
      return false;
    }

    try {
      console.log(`   📥 Loading ${config.displayName} individual schemas...`);
      
      const schemaSet: SchemaSet = {};
      const validatorSet: ValidatorSet = {};
      let loadedCount = 0;

      // Load landing page schema if available
      if (config.schemas.landingPage) {
        try {
          const response = await fetch(publicUrl(config.schemas.landingPage));
          if (response.ok) {
            schemaSet.landingPage = await response.json();
            validatorSet.landingPage = this.ajv.compile(schemaSet.landingPage);
            console.log(`      ✓ Landing page schema loaded`);
            loadedCount++;
          }
        } catch (error) {
          console.warn(`      ⚠️  Failed to load landing page schema:`, error);
        }
      }

      // Load collections schema if available
      if (config.schemas.collections) {
        try {
          const response = await fetch(publicUrl(config.schemas.collections));
          if (response.ok) {
            schemaSet.collections = await response.json();
            validatorSet.collections = this.ajv.compile(schemaSet.collections);
            console.log(`      ✓ Collections schema loaded`);
            loadedCount++;
          }
        } catch (error) {
          console.warn(`      ⚠️  Failed to load collections schema:`, error);
        }
      }

      // Load conformance schema if available
      if (config.schemas.conformance) {
        try {
          const response = await fetch(publicUrl(config.schemas.conformance));
          if (response.ok) {
            schemaSet.conformance = await response.json();
            validatorSet.conformance = this.ajv.compile(schemaSet.conformance);
            console.log(`      ✓ Conformance schema loaded`);
            loadedCount++;
          }
        } catch (error) {
          console.warn(`      ⚠️  Failed to load conformance schema:`, error);
        }
      }

      if (loadedCount === 0) {
        throw new Error('No schemas could be loaded');
      }

      // Store the schemas and validators
      this.loadedSchemas.set(schemaType, schemaSet);
      this.validators.set(schemaType, validatorSet);

      console.log(`   ✅ ${config.displayName}: ${loadedCount} schema(s) loaded`);
      return true;

    } catch (error) {
      console.error(`   ❌ Error loading ${config.displayName}:`, error);
      this.schemaLoadError = error instanceof Error ? error.message : 'Unknown error';
      return false;
    }
  }

  /**
   * Validate collections data against all loaded schemas
   */
  public async validateCollections(data: any): Promise<{ 
    valid: boolean; 
    errors: any[] | null; 
    collectionErrors?: { [collectionId: string]: any[] };
    schemaResults?: Array<{ schema: string; isValid: boolean }>;
  }> {
    if (this.validators.size === 0) return NOTHING_LOADED();

    console.log(`\n🔍 Validating collections against ${this.validators.size} schema(s)...`);
    const schemaNames = Array.from(this.validators.keys()).map(type => {
      const config = SCHEMA_CONFIGS.find(c => c.type === type);
      return config?.displayName || type;
    }).join(', ');
    console.log(`   Schemas: ${schemaNames}\n`);
    
    let overallValid = true;
    const allErrors: any[] = [];
    const collectionErrors: { [collectionId: string]: any[] } = {};
    const schemaResults: Array<{ schema: string; isValid: boolean }> = [];

    // Extract collection IDs from the data for mapping errors
    const collections = data?.collections || [];
    const collectionIndexMap: { [index: number]: string } = {};
    collections.forEach((col: any, index: number) => {
      if (col.id) {
        collectionIndexMap[index] = col.id;
      }
    });

    // Validate against each loaded schema
    this.validators.forEach((validatorSet, schemaType) => {
      if (!validatorSet.collections) {
        return;
      }

      const config = SCHEMA_CONFIGS.find(c => c.type === schemaType);
      const displayName = this.nameOf(config?.displayName || schemaType);

      try {
        const passed = validatorSet.collections(data);
        // As its standard's text rates each, and none an error where the API doesn't declare the schema
        const errors = passed || !validatorSet.collections.errors ? [] : validatorSet.collections.errors.map((error: any) => {
          const path = error.instancePath || error.dataPath || 'root';
          const rule = config?.pathRules?.find(each => each.path.test(path))?.rule ?? config?.rules?.collections;
          return this.rated(asTheTextSays({
            schema: displayName,
            schemaType: schemaType,
            section: 'Collections',
            path,
            message: `${error.instancePath || error.dataPath || ''}: ${error.message}`,
            keyword: error.keyword,
            params: error.params,
            data: error.data,
            ...(rule ? { rule } : {}),
          }, schemaType));
        });
        // Valid where nothing found counts against the server: a MAY the schema requires doesn't
        const isValid = !errors.some(isProblem);

        // Record this schema's result
        schemaResults.push({
          schema: displayName,
          isValid: isValid
        });

        if (passed) {
          console.log(`   ✅ ${displayName}: Valid`);
        } else {
          console.warn(`   ❌ ${displayName}: Validation FAILED`);
          if (!isValid) overallValid = false;

          // Add schema-specific errors
          if (errors.length > 0) {
            // Group errors by collection and tag each error with collectionId
            errors.forEach((err: any) => {
              // Parse path to extract collection index: /collections/0/... or /collections/1/...
              const pathMatch = err.path.match(/^\/collections\/(\d+)/);
              if (pathMatch) {
                const collectionIndex = parseInt(pathMatch[1], 10);
                const collectionId = collectionIndexMap[collectionIndex];
                if (collectionId) {
                  err.collectionId = collectionId;
                  if (!collectionErrors[collectionId]) {
                    collectionErrors[collectionId] = [];
                  }
                  collectionErrors[collectionId].push(err);
                }
              }
            });
            
            // Log first few errors for this schema
            console.warn(`      Errors from ${displayName}:`);
            errors.slice(0, 3).forEach((err: any) => {
              console.warn(`        • ${err.message}`);
            });
            if (errors.length > 3) {
              console.warn(`        ... and ${errors.length - 3} more errors`);
            }
            
            allErrors.push(...errors);
          }
        }
      } catch (error) {
        // The app's own fault: the schema wasn't checked, and that says nothing of the server
        console.error(`   ❌ ${displayName}: Validation error:`, error);
        allErrors.push(this.couldNotCheck(displayName, error, { schemaType }));
      }
    });

    if (overallValid) {
      console.log(`\n✅ All validations passed!\n`);
    } else {
      console.warn(`\n⚠️  Validation completed with ${allErrors.length} error(s) across ${this.validators.size} schema(s)\n`);
    }

    return {
      valid: overallValid,
      errors: allErrors.length > 0 ? allErrors : null,
      collectionErrors: Object.keys(collectionErrors).length > 0 ? collectionErrors : undefined,
      schemaResults: schemaResults.length > 0 ? schemaResults : undefined
    };
  }

  /**
   * Validate landing page data against all loaded schemas
   */
  public async validateLandingPage(data: any): Promise<{ 
    valid: boolean; 
    errors: any[] | null;
    schemaResults?: Array<{ schema: string; isValid: boolean }>;
  }> {
    if (this.validators.size === 0) return NOTHING_LOADED();

    console.log(`🔍 Validating landing page against ${this.validators.size} schema(s)...`);

    let overallValid = true;
    const allErrors: any[] = [];
    const schemaResults: Array<{ schema: string; isValid: boolean }> = [];

    this.validators.forEach((validatorSet, schemaType) => {
      if (!validatorSet.landingPage) {
        return;
      }

      const config = SCHEMA_CONFIGS.find(c => c.type === schemaType);
      const displayName = this.nameOf(config?.displayName || schemaType);

      try {
        const isValid = validatorSet.landingPage(data);
        
        // Record this schema's result
        schemaResults.push({
          schema: displayName,
          isValid: isValid
        });
        
        if (isValid) {
          console.log(`   ✅ ${displayName}: Valid`);
        } else {
          console.warn(`   ⚠️  ${displayName}: Validation issues found`);
          overallValid = false;
          
          if (validatorSet.landingPage.errors) {
            const errors = validatorSet.landingPage.errors.map((error: any) => this.rated({
              schema: displayName,
              section: 'Landing Page',
              path: error.instancePath || error.dataPath || 'root',
              message: `${error.instancePath || error.dataPath || ''}: ${error.message}`,
              keyword: error.keyword,
              params: error.params,
              data: error.data,
              ...(config?.rules?.landingPage ? { rule: config.rules.landingPage } : {}),
            }));
            allErrors.push(...errors);
          }
        }
      } catch (error) {
        // The app's own fault: the schema wasn't checked, and that says nothing of the server
        console.error(`   ❌ ${displayName}: Validation error:`, error);
        allErrors.push(this.couldNotCheck(displayName, error));
      }
    });

    return {
      valid: overallValid,
      errors: allErrors.length > 0 ? allErrors : null,
      schemaResults: schemaResults.length > 0 ? schemaResults : undefined
    };
  }

  /**
   * Validate conformance data against all loaded schemas
   */
  public async validateConformance(data: any): Promise<{ 
    valid: boolean; 
    errors: any[] | null;
    schemaResults?: Array<{ schema: string; isValid: boolean }>;
  }> {
    if (this.validators.size === 0) return NOTHING_LOADED();

    console.log(`🔍 Validating conformance against ${this.validators.size} schema(s)...`);

    let overallValid = true;
    const allErrors: any[] = [];
    const schemaResults: Array<{ schema: string; isValid: boolean }> = [];

    this.validators.forEach((validatorSet, schemaType) => {
      if (!validatorSet.conformance) {
        return;
      }

      const config = SCHEMA_CONFIGS.find(c => c.type === schemaType);
      const displayName = this.nameOf(config?.displayName || schemaType);

      try {
        const isValid = validatorSet.conformance(data);
        
        // Record this schema's result
        schemaResults.push({
          schema: displayName,
          isValid: isValid
        });
        
        if (isValid) {
          console.log(`   ✅ ${displayName}: Valid`);
        } else {
          console.warn(`   ⚠️  ${displayName}: Validation issues found`);
          overallValid = false;
          
          if (validatorSet.conformance.errors) {
            const errors = validatorSet.conformance.errors.map((error: any) => this.rated({
              schema: displayName,
              section: 'Conformance',
              path: error.instancePath || error.dataPath || 'root',
              message: `${error.instancePath || error.dataPath || ''}: ${error.message}`,
              keyword: error.keyword,
              params: error.params,
              data: error.data,
              ...(config?.rules?.conformance ? { rule: config.rules.conformance } : {}),
            }));
            allErrors.push(...errors);
          }
        }
      } catch (error) {
        // The app's own fault: the schema wasn't checked, and that says nothing of the server
        console.error(`   ❌ ${displayName}: Validation error:`, error);
        allErrors.push(this.couldNotCheck(displayName, error));
      }
    });

    return {
      valid: overallValid,
      errors: allErrors.length > 0 ? allErrors : null,
      schemaResults: schemaResults.length > 0 ? schemaResults : undefined
    };
  }

  public isLoaded(): boolean {
    return this.loadedSchemas.size > 0;
  }

  public getLoadError(): string | null {
    return this.schemaLoadError;
  }

  public getLoadedSchemaCount(): number {
    return this.loadedSchemas.size;
  }

  public getLoadedSchemaUrls(): string[] {
    const urls: string[] = [];
    this.loadedSchemas.forEach((_schemaSet, schemaType) => {
      const config = SCHEMA_CONFIGS.find(c => c.type === schemaType);
      if (config) {
        if (config.schemas.landingPage) urls.push(config.schemas.landingPage);
        if (config.schemas.collections) urls.push(config.schemas.collections);
        if (config.schemas.conformance) urls.push(config.schemas.conformance);
      }
    });
    return urls;
  }
}

export default SchemaValidator;
