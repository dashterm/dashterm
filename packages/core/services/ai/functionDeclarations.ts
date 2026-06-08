/**
 * AI function declarations for Gemini API
 */

export const appManagementFunctionDeclarations = [
  {
    name: 'addApp',
    description: 'Add a new app to the dashboard. Use when user asks to add/open/enable an app like "add a todo app" or "open workout tracker"',
    parameters: {
      type: 'object',
      properties: {
        appName: {
          type: 'string',
          description: 'Natural language description of the app to add (e.g., "todo", "workout tracker", "fitness app")'
        }
      },
      required: ['appName']
    }
  },
  {
    name: 'removeApp',
    description: 'Remove an app from the dashboard. Use when user asks to remove/close/hide an app',
    parameters: {
      type: 'object',
      properties: {
        appName: {
          type: 'string',
          description: 'Natural language description of the app to remove (e.g., "todo", "workout tracker")'
        }
      },
      required: ['appName']
    }
  },
  {
    name: 'listAvailableApps',
    description: 'Get a list of all available apps that can be added',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

// Code creation + editing for vibe-coded apps moved to the AgenticCoder
// app (claude -p sessions). AIAssistant only exposes deletion here.
export const customAppFunctionDeclarations = [
  {
    name: 'deleteCustomApp',
    description: 'Delete a custom app. Use when user asks to remove/delete a custom app. To CREATE or EDIT a custom app, direct the user to the AgenticCoder app — that is the supported authoring path.',
    parameters: {
      type: 'object',
      properties: {
        appName: {
          type: 'string',
          description: 'Name of the custom app to delete'
        }
      },
      required: ['appName']
    }
  }
];

export const queryDataFunctionDeclarations = [
  {
    name: 'queryAppData',
    description: 'Query data from any app. Use this to answer questions about data stored in apps, like "What workouts did I do last week?", "Show me my high priority todos", "What exercises was I doing this time last year?". This function can search, filter, and sort data from any app that has queryable data.',
    parameters: {
      type: 'object',
      properties: {
        appId: {
          type: 'string',
          description: 'The app to query data from (e.g., "workout", "todo", "habit")'
        },
        dataSource: {
          type: 'string',
          description: 'The specific data source within the app (e.g., "sets" for workout, "todos" for todo manager)'
        },
        filter: {
          type: 'object',
          description: 'Field-value filters to apply (e.g., {"exercise": "Bench Press", "completed": true})'
        },
        dateRange: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'The date field to filter on (e.g., "timestamp", "createdAt")'
            },
            start: {
              type: 'number',
              description: 'Start timestamp (Unix milliseconds). Use Date.now() math for relative dates.'
            },
            end: {
              type: 'number',
              description: 'End timestamp (Unix milliseconds)'
            }
          },
          description: 'Filter by date range'
        },
        search: {
          type: 'string',
          description: 'Text search query to find matching items'
        },
        sort: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Field to sort by'
            },
            direction: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort direction'
            }
          },
          description: 'How to sort the results'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return'
        }
      },
      required: ['appId', 'dataSource']
    }
  },
  {
    name: 'listQueryableData',
    description: 'List all available queryable data sources across all apps. Use this to discover what data can be queried.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

export const eventLinkFunctionDeclarations = [
  {
    name: 'createEventLink',
    description: 'Create a link between two apps so that when something happens in one app, it triggers an action in another. Use when user says things like "when X happens, do Y" or "automatically do X when Y"',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'A friendly name for this automation (e.g., "Auto-complete workout habit")'
        },
        triggerApp: {
          type: 'string',
          description: 'The app that triggers the event (e.g., "workout", "todo", "habit")'
        },
        triggerEvent: {
          type: 'string',
          description: 'The event to listen for (e.g., "set-logged", "workout-ended", "todo-completed")'
        },
        targetApp: {
          type: 'string',
          description: 'The app to perform the action in (e.g., "habit", "todo")'
        },
        targetAction: {
          type: 'string',
          description: 'The AI function to call in the target app (e.g., "completeHabit", "addTodo")'
        },
        actionParams: {
          type: 'object',
          description: 'Parameters to pass to the target action. Use special value "$event.fieldName" to reference data from the trigger event'
        }
      },
      required: ['name', 'triggerApp', 'triggerEvent', 'targetApp', 'targetAction']
    }
  },
  {
    name: 'listEventLinks',
    description: 'List all event links/automations that have been set up between apps',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'removeEventLink',
    description: 'Remove an event link/automation by its name or ID',
    parameters: {
      type: 'object',
      properties: {
        linkId: {
          type: 'string',
          description: 'The ID or name of the event link to remove'
        }
      },
      required: ['linkId']
    }
  },
  {
    name: 'toggleEventLink',
    description: 'Enable or disable an event link without deleting it',
    parameters: {
      type: 'object',
      properties: {
        linkId: {
          type: 'string',
          description: 'The ID or name of the event link to toggle'
        },
        enabled: {
          type: 'boolean',
          description: 'Whether the link should be enabled or disabled'
        }
      },
      required: ['linkId', 'enabled']
    }
  }
];
