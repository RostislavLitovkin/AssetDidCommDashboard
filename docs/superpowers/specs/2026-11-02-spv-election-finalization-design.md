# SPV Election Finalization Design

## Intent

When an SPV lawyer election has ended but remains unfinalized, keep its governance banner visible and replace **Approve terms** with **Finalize SPV election**. Clicking submits and confirms the marketplace program's `finalize_spv_election` transaction.

## Goals

- Show the finalize action only when the Indexer reports `pendingFinalizations.spvElection`.
- Build the exact Anchor discriminator, arguments, fixed accounts, optional winner registry, and complete remaining candidacy list.
- Reuse the existing Solana wallet sign-and-send and RPC confirmation flow.
- Prevent duplicate submissions and surface submission errors and successful signatures.
- Refresh Indexer state after confirmation.

## Non-goals

- Changing the deployed Solana program or its finalization semantics.
- Changing proposal, challenge, letting-agent, or active SPV voting behavior.
- Adding a new wallet or transaction dependency.

## Constraints

- The existing voting service targets devnet and the existing `VoteTransactionBridge`.
- Voting payloads define `listingId` as equal to the property asset id.
- Finalization is permissionless; any connected wallet capable of signing and sending may crank it.
- A null winner is valid for a tie and uses the marketplace program id as Anchor's `None` account sentinel.
- The candidate list must contain every active candidacy from the finalized round, in Indexer-provided order.

## Approach

Extend `fetchSpvElection` with `pendingFinalizations(assetId: $listingId, listingId: $listingId) { spvElection { winner round candidates } }`. Attach validated finalization evidence to `IndexerSpvElection` only when its round and candidate count agree with the listing snapshot.

Add `buildFinalizeSpvElectionTransaction` to `solanaVote.ts`. Its fixed accounts are cranker (signer), listing (writable), property (readonly), and winner registry (writable) or program-id `None` sentinel. Append writable lawyer-candidacy PDAs as remaining accounts, matching the Solana program's own test helper.

Let `actionableVote` include an expired terms vote only while finalization evidence exists. The banner calls finalization directly instead of opening the vote sheet. Reuse `voteSubmitting`, `voteError`, and `voteNotice`; schedule a refresh after confirmation.

## Alternatives

- **Derive finalizability solely in the browser:** rejected because the Indexer already mirrors the chain gates and supplies the complete candidate evidence.
- **Add a new Indexer endpoint:** unnecessary because `pendingFinalizations.spvElection` already exposes exactly the required data.
- **Submit through the legal settlement service:** rejected because this is a single governance instruction and the existing voting bridge already provides the required wallet and confirmation path.

## Verification

Unit tests pin Indexer parsing, discriminator, account order and flags, Borsh arguments, PDAs, and tied-winner behavior. An end-to-end test starts with an expired election, clicks the finalize button, verifies the submitted instruction, mocks successful RPC confirmation, and checks the success notice. Run the complete dashboard tests, lawyer-review end-to-end suite, lint, typecheck, and production build.

## Assumptions

- No Indexer or Solana production changes are needed because both required surfaces already exist.
- Finalization happens directly from the banner without an additional confirmation sheet, consistent with the existing execute-deal action.
