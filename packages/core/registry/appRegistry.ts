import { AppDefinition, AppRegistry, AIFunctionDefinition, AIFunctionHandler, AppEventDefinition, AppEventListener, AppQueryableData, QueryableDataSchema } from './types';

class AppRegistryImpl implements AppRegistry {
  apps: Record<string, AppDefinition> = {};

  register(app: AppDefinition): void {
    if (this.apps[app.id]) {
      console.warn(`App "${app.id}" is already registered. Overwriting.`);
    }
    this.apps[app.id] = app;

    // Log event registrations
    if (app.events?.emits?.length) {
      console.log(`  └─ Emits events: ${app.events.emits.map(e => `${app.id}:${e.name}`).join(', ')}`);
    }
    if (app.events?.listens?.length) {
      console.log(`  └─ Listens to: ${app.events.listens.map(l => l.eventPattern).join(', ')}`);
    }

    console.log(`Registered app: ${app.id}`);
  }

  unregister(appId: string): void {
    if (this.apps[appId]) {
      delete this.apps[appId];
      console.log(`Unregistered app: ${appId}`);
    }
  }

  get(appId: string): AppDefinition | undefined {
    return this.apps[appId];
  }

  getAll(): AppDefinition[] {
    return Object.values(this.apps);
  }

  getAllAIFunctions(): { definition: AIFunctionDefinition; appId: string; handler: AIFunctionHandler }[] {
    const functions: { definition: AIFunctionDefinition; appId: string; handler: AIFunctionHandler }[] = [];

    for (const app of Object.values(this.apps)) {
      for (const aiFunc of app.aiFunctions) {
        functions.push({
          definition: aiFunc.definition,
          appId: app.id,
          handler: aiFunc.handler,
        });
      }
    }

    return functions;
  }

  getDefaultStates(): Record<string, any> {
    const states: Record<string, any> = {};
    for (const app of Object.values(this.apps)) {
      states[app.id] = app.defaultState;
    }
    return states;
  }

  getGridDefaults(): { id: string; type: string; title: string; height: number; minHeight: number; column: number; order: number }[] {
    return Object.values(this.apps).map(app => ({
      id: app.id,
      type: app.type,
      title: app.title,
      height: app.gridDefaults.height,
      minHeight: app.gridDefaults.minHeight,
      column: app.gridDefaults.column,
      order: app.gridDefaults.order,
    }));
  }

  getAllEmittedEvents(): { appId: string; event: AppEventDefinition }[] {
    const events: { appId: string; event: AppEventDefinition }[] = [];
    for (const app of Object.values(this.apps)) {
      if (app.events?.emits) {
        for (const event of app.events.emits) {
          events.push({ appId: app.id, event });
        }
      }
    }
    return events;
  }

  getAllEventListeners(): { appId: string; listener: AppEventListener }[] {
    const listeners: { appId: string; listener: AppEventListener }[] = [];
    for (const app of Object.values(this.apps)) {
      if (app.events?.listens) {
        for (const listener of app.events.listens) {
          listeners.push({ appId: app.id, listener });
        }
      }
    }
    return listeners;
  }

  getAppEvents(appId: string): { emits: AppEventDefinition[]; listens: AppEventListener[] } | undefined {
    const app = this.apps[appId];
    if (!app) return undefined;
    return {
      emits: app.events?.emits || [],
      listens: app.events?.listens || [],
    };
  }

  getAllQueryableData(): { appId: string; queryable: AppQueryableData }[] {
    const queryables: { appId: string; queryable: AppQueryableData }[] = [];
    for (const app of Object.values(this.apps)) {
      if (app.queryableData) {
        for (const queryable of app.queryableData) {
          queryables.push({ appId: app.id, queryable });
        }
      }
    }
    return queryables;
  }

  getQueryableDataSchemas(): { appId: string; schema: QueryableDataSchema }[] {
    const schemas: { appId: string; schema: QueryableDataSchema }[] = [];
    for (const app of Object.values(this.apps)) {
      if (app.queryableData) {
        for (const queryable of app.queryableData) {
          schemas.push({ appId: app.id, schema: queryable.schema });
        }
      }
    }
    return schemas;
  }

  getAppQueryableData(appId: string): AppQueryableData[] | undefined {
    const app = this.apps[appId];
    if (!app) return undefined;
    return app.queryableData;
  }
}

export const appRegistry = new AppRegistryImpl();

export function registerApp(app: AppDefinition): void {
  appRegistry.register(app);
}

export function getApp(appId: string): AppDefinition | undefined {
  return appRegistry.get(appId);
}

export function getAllApps(): AppDefinition[] {
  return appRegistry.getAll();
}

export function getAllAIFunctions() {
  return appRegistry.getAllAIFunctions();
}

export function getDefaultAppStates(): Record<string, any> {
  return appRegistry.getDefaultStates();
}

export function getGridDefaults() {
  return appRegistry.getGridDefaults();
}

export function getAllEmittedEvents() {
  return appRegistry.getAllEmittedEvents();
}

export function getAllEventListeners() {
  return appRegistry.getAllEventListeners();
}

export function getAppEvents(appId: string) {
  return appRegistry.getAppEvents(appId);
}

export function getAllQueryableData() {
  return appRegistry.getAllQueryableData();
}

export function getQueryableDataSchemas() {
  return appRegistry.getQueryableDataSchemas();
}

export function getAppQueryableData(appId: string) {
  return appRegistry.getAppQueryableData(appId);
}
