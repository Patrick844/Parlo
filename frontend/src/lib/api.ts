/** Typed fetch helpers for the Parlo API. One function per endpoint. */

import type {
  ChatResponse,
  Form,
  FormListItem,
  Insights,
  PublicForm,
  Question,
  QuestionConfig,
  QuestionType,
  SuggestQuestionsResponse,
  Summary,
} from "./types";

export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8200";

const TOKEN_KEY = "parlo_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Thrown for any non-2xx response; carries the backend's `detail` message. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    // A dead token means the creator needs to log in again.
    if (response.status === 401 && options.auth) clearToken();
    let detail = `Request failed (${response.status})`;
    try {
      const data: unknown = await response.json();
      if (data && typeof data === "object" && "detail" in data) {
        detail = String((data as { detail: unknown }).detail);
      }
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

// ---------- auth ----------

/** The current guest plus their demo usage (drives the header indicator). */
export interface Me {
  email: string;
  collections_used: number;
  collections_max: number;
  ai_used_today: number;
  ai_max_per_day: number;
}

/** Email-only entry: get-or-create a workspace and store its token. */
export async function enter(email: string): Promise<void> {
  const data = await request<{ access_token: string }>("/api/auth/enter", {
    method: "POST",
    body: { email },
  });
  setToken(data.access_token);
}

export const getMe = () => request<Me>("/api/auth/me", { auth: true });

// ---------- admin: forms ----------

export const listForms = () =>
  request<FormListItem[]>("/api/admin/forms", { auth: true });

export const createForm = (title: string, size = 10, description = "") =>
  request<Form>("/api/admin/forms", {
    method: "POST",
    body: { title, description, size },
    auth: true,
  });

export const getForm = (id: string) =>
  request<Form>(`/api/admin/forms/${id}`, { auth: true });

export const updateForm = (
  id: string,
  changes: Partial<Pick<Form, "title" | "description" | "is_open">>,
) =>
  request<Form>(`/api/admin/forms/${id}`, {
    method: "PATCH",
    body: changes,
    auth: true,
  });

export const deleteForm = (id: string) =>
  request<{ ok: boolean }>(`/api/admin/forms/${id}`, {
    method: "DELETE",
    auth: true,
  });

// ---------- admin: questions ----------

export interface QuestionDraft {
  text: string;
  type: QuestionType;
  options: string[];
  required: boolean;
  config: QuestionConfig;
}

export const addQuestion = (formId: string, draft: QuestionDraft) =>
  request<Question>(`/api/admin/forms/${formId}/questions`, {
    method: "POST",
    body: draft,
    auth: true,
  });

export const updateQuestion = (questionId: string, changes: Partial<QuestionDraft>) =>
  request<Question>(`/api/admin/questions/${questionId}`, {
    method: "PATCH",
    body: changes,
    auth: true,
  });

export const deleteQuestion = (questionId: string) =>
  request<{ ok: boolean }>(`/api/admin/questions/${questionId}`, {
    method: "DELETE",
    auth: true,
  });

export const reorderQuestions = (formId: string, questionIds: string[]) =>
  request<Question[]>(`/api/admin/forms/${formId}/questions/reorder`, {
    method: "PUT",
    body: { question_ids: questionIds },
    auth: true,
  });

/** Ask the AI for a batch of questions about a topic (nothing is persisted). */
export const suggestQuestions = (formId: string, topic: string, count: number) =>
  request<SuggestQuestionsResponse>(
    `/api/admin/forms/${formId}/suggest-questions`,
    { method: "POST", body: { topic, count }, auth: true },
  );

// ---------- admin: insights ----------

export const getInsights = (formId: string) =>
  request<Insights>(`/api/admin/forms/${formId}/insights`, { auth: true });

export const summarize = (formId: string) =>
  request<Summary>(`/api/admin/forms/${formId}/summarize`, {
    method: "POST",
    auth: true,
  });

/** CSV needs the auth header, so we fetch a blob and trigger a download. */
export async function downloadCsv(formId: string, filename: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/admin/forms/${formId}/export.csv`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!response.ok) throw new ApiError(response.status, "Export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------- public (respondent) ----------

export const getPublicForm = (slug: string) =>
  request<PublicForm>(`/api/forms/${slug}`);

export const sendChat = (
  slug: string,
  sessionId: string | null,
  message: string | null,
  gotoQuestionId: string | null = null,
) =>
  request<ChatResponse>(`/api/chat/${slug}`, {
    method: "POST",
    body: {
      session_id: sessionId,
      message,
      goto_question_id: gotoQuestionId,
    },
  });

/** The public link a creator shares. */
export const publicLink = (slug: string) => `${window.location.origin}/f/${slug}`;
