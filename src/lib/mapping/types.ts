export type Selector = string;

export type StepAction =
  | { type: "goto"; url: string }
  | { type: "waitFor"; selector: Selector; timeoutMs?: number }
  | { type: "click"; selector: Selector }
  | { type: "type"; selector: Selector; text: string; delay?: number }
  | { type: "select"; selector: Selector; value: string }
  | { type: "sleep"; ms: number }
  | { type: "extractTable"; rootSelector: Selector; headSelector?: Selector; rowSelector?: Selector; cellSelector?: Selector }
  | { type: "extract"; name: string; selector: Selector; attr?: string }
  | { type: "eval"; description?: string; fn: string };

export type MappingStep = {
  name: string;
  action: StepAction;
};

export type MappingTask = {
  id: string;
  label: string;
  description?: string;
  steps: MappingStep[];
};

export type RunLog = { t: string; m: string };


