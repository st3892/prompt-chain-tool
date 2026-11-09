export type LlmModel = {
  id: string;
  name: string;
  supports_temperature: boolean;
};

export type PromptChainStep = {
  id: string;
  prompt_chain_id: string;
  step_order: number;
  name: string;
  prompt_template: string;
  llm_model_id: string;
  temperature: number | null;
  created_at: string;
};
