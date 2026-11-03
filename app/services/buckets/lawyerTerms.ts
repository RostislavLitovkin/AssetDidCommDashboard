export const LAWYER_TERMS_APPROVED_TAG = "lawyer/terms-approved";
export const LAWYER_TERMS_REJECTED_TAG = "lawyer/terms-rejected";

export const LAWYER_TERMS_VERDICT_TAGS: readonly string[] = [
  LAWYER_TERMS_APPROVED_TAG,
  LAWYER_TERMS_REJECTED_TAG,
];

const lawyerTermsVerdictTagSet: ReadonlySet<string> = new Set(LAWYER_TERMS_VERDICT_TAGS);

export function isLawyerTermsApprovedTag(tag: string | null | undefined): boolean {
  return tag === LAWYER_TERMS_APPROVED_TAG;
}

export function isLawyerApprovalTag(tag: string | null | undefined): boolean {
  return isLawyerTermsApprovedTag(tag);
}

export function isLawyerTermsRejectedTag(tag: string | null | undefined): boolean {
  return tag === LAWYER_TERMS_REJECTED_TAG;
}

export function isLawyerTermsVerdictTag(tag: string | null | undefined): boolean {
  return tag !== null && tag !== undefined && lawyerTermsVerdictTagSet.has(tag);
}
