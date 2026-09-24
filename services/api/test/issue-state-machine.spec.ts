import { describe, expect, it } from 'vitest';
import { IssueState } from '@prisma/client';
import { issueTransitions } from '../src/issues.service';

describe('issue state machine', () => {
  it('requires live work before resolution', () => {
    expect(issueTransitions[IssueState.RESOLVED]).toContain(IssueState.IN_PROGRESS);
    expect(issueTransitions[IssueState.RESOLVED]).not.toContain(IssueState.REPORTED);
  });

  it('requires resolution before verification and verification before close', () => {
    expect(issueTransitions[IssueState.VERIFIED]).toEqual([IssueState.RESOLVED]);
    expect(issueTransitions[IssueState.CLOSED]).toEqual([IssueState.VERIFIED]);
  });
});
