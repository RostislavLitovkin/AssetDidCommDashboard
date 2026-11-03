import { describe, expect, it } from "vitest";
import * as lawyerTerms from "../../app/services/buckets/lawyerTerms";

const { isLawyerTermsApprovedTag } = lawyerTerms;

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

describe("canonical lawyer Terms verdict messages", () => {
  it("routes approvals and rejections through the Terms lane without parallel review tags", () => {
    const isVerdict = (lawyerTerms as Record<string, unknown>).isLawyerTermsVerdictTag as (tag: string | null) => boolean;
    expect(lawyerTerms.LAWYER_TERMS_VERDICT_TAGS).toEqual(["lawyer/terms-approved", "lawyer/terms-rejected"]);
    expect(isVerdict("lawyer/terms-approved")).toBe(true);
    expect(isVerdict("lawyer/terms-rejected")).toBe(true);
    expect(isVerdict("lawyer/terms-document")).toBe(false);
    expect(isVerdict("voting/terms")).toBe(false);
    expect(isVerdict(null)).toBe(false);
  });
});
