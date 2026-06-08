/**
 * Query Data Handlers
 * Handles queryAppData and listQueryableData AI functions
 */

import { SystemContext } from '../../types';
import { getApp, getAllQueryableData, AppContext } from '../../registry';
import { QueryOptions } from '../../registry/types';
import { getAppStateFromContext } from './appStateHelpers';

/**
 * Query data from an app
 */
export function handleQueryAppData(
  args: {
    appId: string;
    dataSource: string;
    filter?: Record<string, any>;
    dateRange?: {
      field: string;
      start?: number;
      end?: number;
    };
    search?: string;
    sort?: {
      field: string;
      direction: 'asc' | 'desc';
    };
    limit?: number;
  },
  context: SystemContext,
  _appActions?: any
): { success: boolean; message: string; data?: any } {
  const { appId, dataSource, filter, dateRange, search, sort, limit } = args;

  // Get the app definition
  const appDef = getApp(appId);
  if (!appDef) {
    return {
      success: false,
      message: `App "${appId}" not found. Use listQueryableData to see available apps.`
    };
  }

  // Find the queryable data source
  const queryable = appDef.queryableData?.find(q => q.schema.name === dataSource);
  if (!queryable) {
    const availableSources = appDef.queryableData?.map(q => q.schema.name).join(', ') || 'none';
    return {
      success: false,
      message: `Data source "${dataSource}" not found in app "${appId}". Available sources: ${availableSources}`
    };
  }

  // Get app state
  const appState = getAppStateFromContext(appId, context);

  // Build app context for the query handler
  const appContext: AppContext = {
    state: appState,
    updateState: () => {}, // Read-only for queries
    userProfile: context.userProfile,
    allAppStates: context.appInstances || {},
    emit: () => {},
    subscribe: () => () => {},
  };

  // Build query options
  const queryOptions: QueryOptions = {
    filter,
    dateRange,
    search,
    sort,
    limit
  };

  try {
    // Execute the query
    const result = queryable.getData(queryOptions, appContext);

    // Format the response
    const schema = queryable.schema;
    let message = '';

    if (result.filtered === 0) {
      message = `No ${schema.itemName}s found matching your query.`;
      if (result.total > 0) {
        message += ` (${result.total} total ${schema.name} in the app)`;
      }
    } else {
      message = `Found ${result.filtered} ${schema.itemName}${result.filtered === 1 ? '' : 's'}`;
      if (result.filtered !== result.total) {
        message += ` (out of ${result.total} total)`;
      }
      message += ':\n\n';

      // Format each item based on the schema fields
      result.items.forEach((item: any, index: number) => {
        message += `${index + 1}. `;
        const parts: string[] = [];

        // Build a readable representation of each item
        Object.entries(schema.fields).forEach(([field, fieldSchema]) => {
          if (item[field] !== undefined && item[field] !== null) {
            let value = item[field];

            // Format dates
            if (fieldSchema.type === 'date' && typeof value === 'number') {
              value = new Date(value).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            }

            parts.push(`${field}: ${value}`);
          }
        });

        message += parts.join(', ') + '\n';
      });
    }

    return {
      success: true,
      message,
      data: result
    };
  } catch (error) {
    return {
      success: false,
      message: `Error querying data: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * List all available queryable data sources
 */
export function handleListQueryableData(): { success: boolean; message: string } {
  const allQueryable = getAllQueryableData();

  if (allQueryable.length === 0) {
    return {
      success: true,
      message: 'No queryable data sources are currently available. Add apps with queryable data to enable data queries.'
    };
  }

  let message = 'Available queryable data sources:\n\n';

  // Group by app
  const byApp = new Map<string, typeof allQueryable>();
  for (const item of allQueryable) {
    if (!byApp.has(item.appId)) {
      byApp.set(item.appId, []);
    }
    byApp.get(item.appId)!.push(item);
  }

  for (const [appId, sources] of byApp) {
    const appDef = getApp(appId);
    message += `📱 ${appDef?.title || appId}:\n`;

    for (const { queryable } of sources) {
      const schema = queryable.schema;
      message += `   🔍 ${schema.name}: ${schema.description}\n`;
      message += `      Fields: ${Object.keys(schema.fields).join(', ')}\n`;

      if (schema.examples && schema.examples.length > 0) {
        message += `      Example queries:\n`;
        schema.examples.slice(0, 2).forEach(example => {
          message += `        - "${example}"\n`;
        });
      }
      message += '\n';
    }
  }

  return {
    success: true,
    message
  };
}
