import { describe, expect, it } from "vitest";
import { isLawyerTermsApprovedTag } from "../../app/services/buckets/lawyerTerms";

describe("isLawyerTermsApprovedTag", () => {
  it("accepts only the voter approval message tag", () => {
    expect(isLawyerTermsApprovedTag("lawyer/terms-approved")).toBe(true);
    expect(isLawyerTermsApprovedTag("lawyer/terms-vote")).toBe(false);
    expect(isLawyerTermsApprovedTag("lawyer/terms-document")).toBe(false);
    expect(isLawyerTermsApprovedTag("voting/terms")).toBe(false);
    expect(isLawyerTermsApprovedTag(null)).toBe(false);
    expect(isLawyerTermsApprovedTag(undefined)).toBe(false);
  });
});
