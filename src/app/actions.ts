"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PromptChain } from "@/lib/prompt-chains";
import type { PromptChainStep } from "@/lib/prompt-chain-steps";
import {
  getDatabaseErrorMessage,
  getSuperadminClient,
} from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type PromptChainActionResult =
  | { success: true; message: string; chain?: PromptChain }
  | { success: false; message: string };

type PromptChainStepActionResult =
  | { success: true; message: string; step?: PromptChainStep; steps?: PromptChainStep[] }
  | { success: false; message: string };

function getPromptChainFields(formData: FormData) {
  const name = formData.get("name");
  const description = formData.get("description");

  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Enter a name for the prompt chain." } as const;
  }

  if (description !== null && typeof description !== "string") {
    return { ok: false, error: "Enter a valid description." } as const;
  }

  return {
    ok: true,
    fields: {
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : "",
    },
  } as const;
}

function getChainId(id: string) {
  return /^\d+$/.test(id) ? id : null;
}

type StepContentFields = {
  name: string;
  prompt_template: string;
};

type StepModelFields = StepContentFields & {
  llm_model_id: string;
  temperature: number;
};

type StepFieldError = { ok: false; error: string };

function getStepFields(
  formData: FormData,
): StepFieldError | { ok: true; fields: StepModelFields };
function getStepFields(
  formData: FormData,
  requireModel: false,
): StepFieldError | { ok: true; fields: StepContentFields | StepModelFields };
function getStepFields(
  formData: FormData,
  requireModel = true,
):
  | StepFieldError
  | { ok: true; fields: StepContentFields | StepModelFields } {
  const name = formData.get("name");
  const promptTemplate = formData.get("prompt_template");
  const modelId = formData.get("llm_model_id");
  const temperature = formData.get("temperature");

  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Enter a name for this step." } as const;
  }
  if (typeof promptTemplate !== "string" || !promptTemplate.trim()) {
    return { ok: false, error: "Enter a prompt template for this step." } as const;
  }
  if ((!modelId || modelId === "") && !requireModel) {
    return {
      ok: true,
      fields: {
        name: name.trim(),
        prompt_template: promptTemplate.trim(),
      },
    } as const;
  }
  if (typeof modelId !== "string" || !/^\d+$/.test(modelId)) {
    return { ok: false, error: "Select an active AI model." } as const;
  }

  const parsedTemperature =
    typeof temperature === "string" && temperature.trim()
      ? Number(temperature)
      : 0;
  if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0) {
    return { ok: false, error: "Temperature must be a non-negative number." } as const;
  }

  return {
    ok: true,
    fields: {
      name: name.trim(),
      prompt_template: promptTemplate.trim(),
      llm_model_id: modelId,
      temperature: parsedTemperature,
    },
  } as const;
}

function mapPromptChainStep(row: {
  id: number | string;
  prompt_chain_id: number | string;
  step_order: number;
  name: string;
  prompt_template: string;
  llm_model_id: number | string;
  temperature: number | string | null;
  created_at: string;
}): PromptChainStep {
  return {
    id: String(row.id),
    prompt_chain_id: String(row.prompt_chain_id),
    step_order: row.step_order,
    name: row.name,
    prompt_template: row.prompt_template,
    llm_model_id: String(row.llm_model_id),
    temperature: row.temperature === null ? null : Number(row.temperature),
    created_at: row.created_at,
  };
}

async function getActiveModel(
  supabase: SupabaseClient,
  modelId: string,
) {
  return supabase
    .from("llm_models")
    .select("id, supports_temperature")
    .eq("id", modelId)
    .eq("is_active", true)
    .maybeSingle();
}

export async function getPromptChainSteps(
  chainId: string,
): Promise<PromptChainStepActionResult> {
  const parsedChainId = getChainId(chainId);
  if (!parsedChainId) return { success: false, message: "Invalid prompt chain." };

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return { success: false, message: authorization.error };
  }

  const { data, error } = await authorization.supabase
    .from("prompt_chain_steps")
    .select("id, prompt_chain_id, step_order, name, prompt_template, llm_model_id, temperature, created_at")
    .eq("prompt_chain_id", parsedChainId)
    .order("step_order", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("Unable to load prompt chain steps.", error);
    return {
      success: false,
      message: getDatabaseErrorMessage(error, "prompt_chain_steps"),
    };
  }

  return {
    success: true,
    message: "Steps loaded.",
    steps: data.map(mapPromptChainStep),
  };
}

export async function createPromptChainStep(
  chainId: string,
  formData: FormData,
): Promise<PromptChainStepActionResult> {
  const parsedChainId = getChainId(chainId);
  if (!parsedChainId) return { success: false, message: "Invalid prompt chain." };

  const fields = getStepFields(formData);
  if (!fields.ok) return { success: false, message: fields.error };

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return { success: false, message: authorization.error };
  }

  const { data: model, error: modelError } = await getActiveModel(
    authorization.supabase,
    fields.fields.llm_model_id,
  );
  if (modelError) {
    console.error("Unable to verify the selected AI model.", modelError);
    return {
      success: false,
      message: getDatabaseErrorMessage(modelError, "llm_models"),
    };
  }
  if (!model) {
    return {
      success: false,
      message: "That AI model is not active or is not available to your account.",
    };
  }

  const { data: lastStep, error: orderError } = await authorization.supabase
    .from("prompt_chain_steps")
    .select("step_order")
    .eq("prompt_chain_id", parsedChainId)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError) {
    console.error("Unable to determine the next step order.", orderError);
    return {
      success: false,
      message: getDatabaseErrorMessage(orderError, "prompt_chain_steps"),
    };
  }

  const payload = {
    prompt_chain_id: parsedChainId,
    step_order: (lastStep?.step_order ?? 0) + 1,
    name: fields.fields.name,
    prompt_template: fields.fields.prompt_template,
    llm_model_id: fields.fields.llm_model_id,
    temperature: model.supports_temperature ? fields.fields.temperature : 0,
  };
  const { data, error } = await authorization.supabase
    .from("prompt_chain_steps")
    .insert(payload)
    .select("id, prompt_chain_id, step_order, name, prompt_template, llm_model_id, temperature, created_at")
    .single();

  if (error) {
    console.error("Unable to create prompt chain step.", error);
    return {
      success: false,
      message: getDatabaseErrorMessage(error, "prompt_chain_steps"),
    };
  }

  return {
    success: true,
    message: "Step created successfully.",
    step: mapPromptChainStep(data),
  };
}

export async function updatePromptChainStep(
  chainId: string,
  stepId: string,
  formData: FormData,
): Promise<PromptChainStepActionResult> {
  const parsedChainId = getChainId(chainId);
  const parsedStepId = getChainId(stepId);
  if (!parsedChainId || !parsedStepId) {
    return { success: false, message: "Invalid prompt chain step." };
  }

  const fields = getStepFields(formData, false);
  if (!fields.ok) return { success: false, message: fields.error };

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return { success: false, message: authorization.error };
  }

  const updateFields: StepContentFields & {
    llm_model_id?: string;
    temperature?: number;
  } = {
    name: fields.fields.name,
    prompt_template: fields.fields.prompt_template,
  };

  if ("llm_model_id" in fields.fields) {
    const { data: model, error: modelError } = await getActiveModel(
      authorization.supabase,
      fields.fields.llm_model_id,
    );
    if (modelError) {
      console.error("Unable to verify the selected AI model.", modelError);
      return {
        success: false,
        message: getDatabaseErrorMessage(modelError, "llm_models"),
      };
    }
    if (!model) {
      return {
        success: false,
        message: "That AI model is not active or is not available to your account.",
      };
    }

    updateFields.llm_model_id = fields.fields.llm_model_id;
    updateFields.temperature = model.supports_temperature
      ? fields.fields.temperature
      : 0;
  }

  const { data, error } = await authorization.supabase
    .from("prompt_chain_steps")
    .update(updateFields)
    .eq("id", parsedStepId)
    .eq("prompt_chain_id", parsedChainId)
    .select("id, prompt_chain_id, step_order, name, prompt_template, llm_model_id, temperature, created_at")
    .maybeSingle();

  if (error) {
    console.error("Unable to update prompt chain step.", error);
    return {
      success: false,
      message: getDatabaseErrorMessage(error, "prompt_chain_steps"),
    };
  }
  if (!data) {
    return {
      success: false,
      message: "Step not found, or it is not available under the current RLS policies.",
    };
  }

  return {
    success: true,
    message: "Step updated successfully.",
    step: mapPromptChainStep(data),
  };
}

export async function deletePromptChainStep(
  chainId: string,
  stepId: string,
): Promise<PromptChainStepActionResult> {
  const parsedChainId = getChainId(chainId);
  const parsedStepId = getChainId(stepId);
  if (!parsedChainId || !parsedStepId) {
    return { success: false, message: "Invalid prompt chain step." };
  }

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return { success: false, message: authorization.error };
  }

  const { error, count } = await authorization.supabase
    .from("prompt_chain_steps")
    .delete({ count: "exact" })
    .eq("id", parsedStepId)
    .eq("prompt_chain_id", parsedChainId);

  if (error) {
    console.error("Unable to delete prompt chain step.", error);
    return {
      success: false,
      message: getDatabaseErrorMessage(error, "prompt_chain_steps"),
    };
  }
  if (count === 0) {
    return {
      success: false,
      message: "Step not found, or it is not available under the current RLS policies.",
    };
  }

  return { success: true, message: "Step deleted successfully." };
}

export async function movePromptChainStep(
  chainId: string,
  stepId: string,
  direction: "up" | "down",
): Promise<PromptChainStepActionResult> {
  const parsedChainId = getChainId(chainId);
  const parsedStepId = getChainId(stepId);
  if (!parsedChainId || !parsedStepId) {
    return { success: false, message: "Invalid prompt chain step." };
  }
  if (direction !== "up" && direction !== "down") {
    return { success: false, message: "Invalid step direction." };
  }

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return { success: false, message: authorization.error };
  }

  const { data: rows, error: loadError } = await authorization.supabase
    .from("prompt_chain_steps")
    .select("id, prompt_chain_id, step_order, name, prompt_template, llm_model_id, temperature, created_at")
    .eq("prompt_chain_id", parsedChainId)
    .order("step_order", { ascending: true })
    .order("id", { ascending: true });

  if (loadError) {
    console.error("Unable to load steps for reordering.", loadError);
    return {
      success: false,
      message: getDatabaseErrorMessage(loadError, "prompt_chain_steps"),
    };
  }

  const currentIndex = rows.findIndex((step) => String(step.id) === parsedStepId);
  const neighborIndex = currentIndex + (direction === "up" ? -1 : 1);
  if (currentIndex < 0 || neighborIndex < 0 || neighborIndex >= rows.length) {
    return { success: false, message: "That step cannot be moved in this direction." };
  }

  const moving = rows[currentIndex];
  const neighbor = rows[neighborIndex];
  const temporaryOrder =
    Math.max(...rows.map((step) => step.step_order), 0) + 1;

  // Use a temporary order so each update avoids colliding with the neighbor's order.
  const moveToTemporary = await authorization.supabase
    .from("prompt_chain_steps")
    .update({ step_order: temporaryOrder })
    .eq("id", moving.id)
    .eq("prompt_chain_id", parsedChainId)
    .select("id")
    .maybeSingle();

  if (moveToTemporary.error || !moveToTemporary.data) {
    const error = moveToTemporary.error;
    if (error) console.error("Unable to start step reordering.", error);
    return {
      success: false,
      message: error
        ? getDatabaseErrorMessage(error, "prompt_chain_steps")
        : "Step could not be updated under the current RLS policies.",
    };
  }

  const moveNeighbor = await authorization.supabase
    .from("prompt_chain_steps")
    .update({ step_order: moving.step_order })
    .eq("id", neighbor.id)
    .eq("prompt_chain_id", parsedChainId)
    .select("id")
    .maybeSingle();

  if (moveNeighbor.error || !moveNeighbor.data) {
    const error = moveNeighbor.error;
    const restore = await authorization.supabase
      .from("prompt_chain_steps")
      .update({ step_order: moving.step_order })
      .eq("id", moving.id)
      .eq("prompt_chain_id", parsedChainId);
    if (restore.error) {
      console.error("Unable to restore step order after a failed move.", restore.error);
    }
    if (error) console.error("Unable to move the neighboring step.", error);
    return {
      success: false,
      message: error
        ? getDatabaseErrorMessage(error, "prompt_chain_steps")
        : "The neighboring step could not be updated under the current RLS policies.",
    };
  }

  const finishMove = await authorization.supabase
    .from("prompt_chain_steps")
    .update({ step_order: neighbor.step_order })
    .eq("id", moving.id)
    .eq("prompt_chain_id", parsedChainId)
    .select("id")
    .maybeSingle();

  if (finishMove.error || !finishMove.data) {
    const error = finishMove.error;
    const restoreNeighbor = await authorization.supabase
      .from("prompt_chain_steps")
      .update({ step_order: neighbor.step_order })
      .eq("id", neighbor.id)
      .eq("prompt_chain_id", parsedChainId);
    const restoreMoving = await authorization.supabase
      .from("prompt_chain_steps")
      .update({ step_order: moving.step_order })
      .eq("id", moving.id)
      .eq("prompt_chain_id", parsedChainId);
    if (restoreNeighbor.error || restoreMoving.error) {
      console.error("Unable to restore step order after a failed move.", {
        neighbor: restoreNeighbor.error,
        moving: restoreMoving.error,
      });
    }
    if (error) console.error("Unable to finish step reordering.", error);
    return {
      success: false,
      message: error
        ? getDatabaseErrorMessage(error, "prompt_chain_steps")
        : "The step could not be updated under the current RLS policies.",
    };
  }

  return { success: true, message: "Step order updated successfully." };
}

export async function createPromptChain(
  formData: FormData,
): Promise<PromptChainActionResult> {
  const fields = getPromptChainFields(formData);
  if (!fields.ok) return { success: false, message: fields.error };

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return { success: false, message: authorization.error };
  }

  const { data, error } = await authorization.supabase
    .from("prompt_chains")
    .insert(fields.fields)
    .select("id, name, description")
    .single();

  if (error) {
    console.error("Unable to create prompt chain.", error);
    return { success: false, message: getDatabaseErrorMessage(error) };
  }

  return {
    success: true,
    message: "Prompt chain created successfully.",
    chain: {
      id: String(data.id),
      name: data.name,
      description: data.description,
    },
  };
}

export async function updatePromptChain(
  id: string,
  formData: FormData,
): Promise<PromptChainActionResult> {
  const chainId = getChainId(id);
  if (!chainId) return { success: false, message: "Invalid prompt chain." };

  const fields = getPromptChainFields(formData);
  if (!fields.ok) return { success: false, message: fields.error };

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return { success: false, message: authorization.error };
  }

  const { data, error } = await authorization.supabase
    .from("prompt_chains")
    .update(fields.fields)
    .eq("id", chainId)
    .select("id, name, description")
    .maybeSingle();

  if (error) {
    console.error("Unable to update prompt chain.", error);
    return { success: false, message: getDatabaseErrorMessage(error) };
  }

  if (!data) {
    return {
      success: false,
      message: "Prompt chain not found, or it is not available under the current RLS policies.",
    };
  }

  const chain: PromptChain = {
    id: String(data.id),
    name: data.name,
    description: data.description,
  };

  return {
    success: true,
    message: "Prompt chain updated successfully.",
    chain,
  };
}

export async function deletePromptChain(
  id: string,
): Promise<PromptChainActionResult> {
  const chainId = getChainId(id);
  if (!chainId) return { success: false, message: "Invalid prompt chain." };

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return { success: false, message: authorization.error };
  }

  const { error, count } = await authorization.supabase
    .from("prompt_chains")
    .delete({ count: "exact" })
    .eq("id", chainId);

  if (error) {
    console.error("Unable to delete prompt chain.", error);
    return { success: false, message: getDatabaseErrorMessage(error) };
  }

  if (count === 0) {
    return {
      success: false,
      message: "Prompt chain not found, or it is not available under the current RLS policies.",
    };
  }

  return { success: true, message: "Prompt chain deleted successfully." };
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("Unable to sign out.", error);
    throw new Error("Unable to sign out. Please try again.");
  }

  redirect("/");
}
