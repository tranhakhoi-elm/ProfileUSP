/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ProductInput {
  name: string;
  description: string;
  imageUrl?: string;
}

export interface CriteriaAnalysisItem {
  id: string;
  title: string;
  detail: string;
  answers: { question: string; answer: string }[];
}

export interface CustomerPersona {
  id: string; // generated client-side or server-side
  name: string;
  demographics: string;
  painPoints: string;
  benefits: string;
  summary: string;
}

export interface PainPointUSP {
  id: string; // generated e.g. "usp-1"
  painPoint: string;
  usp: string;
  description: string;
}

export interface FinalMasterRow {
  stt: number;
  step: string;
  psychologicalGoal: string;
  painPointAndDesire: string;
  stepsDetail: string;
  uspDetail: string;
  headlineSubheadline: string;
  visualKey: string;
  imageUrl?: string;
  isGeneratingImage?: boolean;
}

export interface ParsedSheet {
  name: string;
  rows: string[][];
}

export interface MasterFileState {
  product: ProductInput;
  personas: CustomerPersona[];
  selectedPersona: CustomerPersona | null;
  usps: PainPointUSP[];
  selectedUsps: string[]; // list of USP IDs chosen (exactly 5 for the final master file)
}
