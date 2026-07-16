/** Shared TypeScript types — mirrors the backend's pydantic schemas. */

export type QuestionType =
  | "text"
  | "single_choice"
  | "multi_choice"
  | "rating"
  | "number"
  | "email"
  | "distribution";

/** Per-type answer settings. Which keys apply depends on the question type:
 *  rating → min_value/max_value, text → min_length/max_length,
 *  number → min_value/max_value, multi_choice → max_choices. */
export type QuestionConfig = Record<string, number>;

export interface Question {
  id: string;
  position: number;
  text: string;
  type: QuestionType;
  options: string[];
  required: boolean;
  config: QuestionConfig;
}

export interface Form {
  id: string;
  title: string;
  description: string;
  slug: string;
  is_open: boolean;
  size: number;
  created_at: string;
  questions: Question[];
}

/** Dashboard row: a form plus its headline numbers. */
export interface FormListItem {
  id: string;
  title: string;
  slug: string;
  is_open: boolean;
  size: number;
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

/** The single question the respondent should answer right now. */
export interface CurrentQuestion {
  id: string;
  text: string;
  type: QuestionType;
  options: string[];
  required: boolean;
  config: QuestionConfig;
  position: number; // 1-based
  total: number;
}

export interface ChatProgress {
  answered: number;
  total: number;
}

export interface ChatResponse {
  session_id: string;
  reply: string;
  question: CurrentQuestion | null; // null once the conversation is done
  progress: ChatProgress;
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
