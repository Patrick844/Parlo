/** Shared TypeScript types — mirrors the backend's pydantic schemas. */

export type QuestionType =
  | "text"
  | "single_choice"
  | "multi_choice"
  | "rating"
  | "number"
  | "email"
  | "distribution";

export interface Question {
  id: string;
  position: number;
  text: string;
  type: QuestionType;
  options: string[];
  required: boolean;
}

export interface Form {
  id: string;
  title: string;
  description: string;
  slug: string;
  is_open: boolean;
  created_at: string;
  questions: Question[];
}

/** Dashboard row: a form plus its headline numbers. */
export interface FormListItem {
  id: string;
  title: string;
  slug: string;
  is_open: boolean;
  created_at: string;
  question_count: number;
  respondents: number;
  completed: number;
  completion_rate: number;
}

/** What a respondent sees before starting. */
export interface PublicForm {
  title: string;
  description: string;
  question_count: number;
  is_open: boolean;
}

export interface ChatResponse {
  session_id: string;
  reply: string;
  done: boolean;
}

/** One option's mean allocation for a distribution question. */
export interface DistributionInsight {
  option: string;
  avg: number;
}

export interface QuestionInsight {
  question_id: string;
  text: string;
  type: QuestionType;
  answer_count: number;
  counts: Record<string, number>;
  average: number | null;
  values: string[];
  distribution: DistributionInsight[];
}

export interface DayCount {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface Insights {
  form_id: string;
  title: string;
  sessions_started: number;
  sessions_completed: number;
  completion_rate: number;
  answers_by_day: DayCount[];
  questions: QuestionInsight[];
}

export interface Summary {
  bullets: string[];
  sentiment: string;
}

/** One AI-suggested question the creator can cherry-pick into the form.
 *  The builder groups these by `type` — there is no topical category. */
export interface SuggestedQuestion {
  text: string;
  type: QuestionType;
  options: string[];
  required: boolean;
}

export interface SuggestQuestionsResponse {
  count: number; // effective number requested (clamped to remaining slots)
  suggestions: SuggestedQuestion[];
}
