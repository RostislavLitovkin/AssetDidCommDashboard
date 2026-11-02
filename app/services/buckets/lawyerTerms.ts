export const LAWYER_TERMS_APPROVED_TAG = "lawyer/terms-approved";

export function isLawyerTermsApprovedTag(tag: string | null | undefined): boolean {
  return tag === LAWYER_TERMS_APPROVED_TAG;
}
