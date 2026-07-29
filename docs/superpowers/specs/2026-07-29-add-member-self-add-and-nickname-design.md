# Add Member — Self-Add Button & Nickname Entry — Design

Date: 2026-07-29

## Goal

Two improvements to `/messages/bucket/add-member/[id]`:

1. The member entry accepts a **nickname** as well as an SS58/Solana address,
   resolving the nickname to a profile (and therefore an address) before submit.
2. The page **recognizes existing membership** — it hides the new inline
   "Add me" self-add button when the connected wallet is already a member, and
   warns when the entered member already holds the selected role.

## 1. Address-or-nickname entry

One field, relabelled **Member Address or Nickname** with placeholder
`SS58 address or nickname`. No mode toggle and no `@` prefix — the kind is
detected from the value:

- **Address-like** (SS58-decodable, or `isSolanaAddress`) →
  `ProfileClient.getProfile(normalizeApiAddress(value))`, as today.
- **Anything else** → `ProfileClient.getProfileByNickname(value)`.

Debounce (400 ms) plus blur trigger, and the stale-response guard comparing the
raw field value, are unchanged.

Status messages branch on the resolved kind:

| Outcome              | Address input                                                | Nickname input                                    |
|----------------------|--------------------------------------------------------------|---------------------------------------------------|
| Found, has X25519    | `✓ Profile found — {nickname}`                                | `✓ Profile found — {nickname} · {5Grw…utQY}`      |
| Found, no X25519 key | "This profile has no X25519 encryption key and cannot be added." | same                                           |
| 404                  | "No profile exists for this address, so it cannot be added."  | "No profile found with the nickname \"{value}\"." |

A nickname hit keeps the typed nickname in the field; the resolved address is
shown in the status line rather than replacing what the user typed.

**Submit uses the resolved profile address.** `submitAddMember` currently sends
`normalizeApiAddress(memberAddress)`; it must send
`normalizeApiAddress(profile.ss58Address)` so a nickname can never reach the
chain as a subject. This is the correctness-critical part of the change.

## 2. Inline "Add me" button

A small button pinned inside the right edge of the member input, with matching
`padding-right` on the input so long addresses do not slide underneath it.

Clicking **fills** the field with the connected wallet address (formatted via
`useAddress().formatAddress`, i.e. the user's chosen SS58 prefix). It does not
submit — the role selector and the normal profile-confirmation flow still apply.

Visible only when all hold:

- a wallet is connected,
- the member lists have finished loading,
- the connected wallet is **not** already a member,
- the field does not already contain the connected address,
- no submit is in flight.

If the member lists fail to load, the button is shown. Failing open is better
than silently removing a useful affordance because a query failed.

## 3. Already-a-member recognition

On mount, in parallel with the existing bucket fetch: `fetchBucketAdmins`,
`fetchBucketContributors`, `fetchBucketViewers`, plus the connected wallet's own
profile via `useProfileStatus` (a shared store, so no duplicate request) to
obtain its X25519 key.

Role matching follows what `info.vue` already established:

- **admin / contributor** — matched by `addressesEqual` against the subject lists.
- **viewer** — viewers are keyed on-chain by X25519 key, not address, so matched
  by `normalizeX25519ToJwkX` equality against the profile's key.

Role implications mirror `addBucketMemberWithRole`:

| Selected role | Grants                          |
|---------------|---------------------------------|
| Admin         | admin + contributor + viewer    |
| Contributor   | contributor + viewer            |
| Viewer        | viewer                          |

Behaviour for the entered member:

- Holds **every** granted role → red note
  "Already an admin, contributor and viewer of this bucket." and submit disabled.
- Holds **some** → neutral note
  "Already a contributor — adding as Admin grants the remaining roles."
  Submit stays enabled; promotion is legitimate.
- Holds none → no note.

After a successful add the member lists reload, so self-adding makes the
"Add me" button disappear instead of going stale.

## 4. Code organization

The page script is already ~260 lines. Three pure helpers move out so they are
unit-testable under the existing vitest suite, leaving the page as wiring:

- `isAddressLike(value)` → `app/services/wallet/addressUtils.ts`
- `resolveProfileByAddressOrNickname(client, value)` →
  `app/services/profile/profileLookup.ts`, returning
  `{ kind: "address" | "nickname"; profile: Profile | null }`
- `rolesGrantedBy(role)` and `rolesHeld({ address, x25519Key }, lists)` →
  `app/services/buckets/membership.ts`

## Out of scope

- Changes to `info.vue` (its own membership logic stays as it is).
- Removing members or roles.
- Profile creation or editing.
