export interface CompileRequest {
  code: string;
  appName?: string;
}

export interface CreateAppRequest {
  name: string;
  description: string;
  requirements: string;
}

export interface FixAppRequest {
  code: string;
  error: string;
  name: string;
  maxRetries?: number;
}

export interface TestAppRequest {
  name: string;
  description: string;
  requirements: string;
}

export interface CompileResponse {
  success: boolean;
  compiledCode?: string;
  appName?: string;
  error?: string;
  details?: string[];
}

export interface CreateAppResponse {
  success: boolean;
  appId?: string;
  name?: string;
  description?: string;
  code?: string;
  compiledCode?: string;
  functions?: AIFunctionDeclaration[];
  error?: string;
  details?: string[];
  autoFixAttempted?: boolean;
  autoFixed?: boolean;
  fixAttempts?: number;
}

export interface FixAppResponse {
  success: boolean;
  fixedCode?: string;
  compiledCode?: string;
  attempts?: number;
  lastError?: string;
  message?: string;
  error?: string;
  details?: string;
}

export interface TestAppResponse {
  timestamp: string;
  appName: string;
  tests: {
    generation: TestResult;
    compilation: TestResult;
    validation: TestResult;
    runtime: TestResult;
  };
  overallResult: 'pending' | 'passed' | 'failed' | 'partial';
}

export interface TestResult {
  status: 'pending' | 'passed' | 'failed';
  details: any;
}

export interface AIFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

// Agent-based editing types
export interface EditAppAgentRequest {
  code: string;
  request: string;
  name: string;
  maxTurns?: number;
}

export interface EditAppAgentResponse {
  success: boolean;
  code?: string;
  compiledCode?: string;
  summary?: string;
  error?: string;
  turnsUsed: number;
  editHistory: Array<{
    action: string;
    section: string;
    timestamp: number;
  }>;
}

export interface CreateAppAgentRequest {
  name: string;
  description: string;
  requirements: string;
}

export interface TypeCheckRequest {
  code: string;
  appName?: string;
}

export interface TypeCheckResponse {
  success: boolean;
  errors: Array<{
    file: string;
    line: number;
    column: number;
    code: string;
    message: string;
    severity: 'error' | 'warning';
  }>;
  errorCount: number;
  warningCount: number;
}
