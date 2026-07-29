/**
 * Which bucket roles an identity already holds, and which roles adding someone
 * under a given role actually grants. Pure so the add-member page can tell
 * "already a member" from "eligible for promotion" without re-deriving the
 * chain's role implications inline.
 */
import { normalizeX25519ToJwkX } from "./valueCodecs"
import type { BucketMemberRole } from "./types"
import { addressesEqual } from "../wallet/addressUtils"

export interface BucketMemberLists {
  admins: string[]
  contributors: string[]
  /** On-chain viewer identifiers — X25519 keys, not addresses. */
  viewers: string[]
}

export interface MemberIdentity {
  address: string
  /** The member's profile X25519 key, in any form normalizeX25519ToJwkX accepts. */
  x25519Key?: string | null
}

/**
 * The roles `addBucketMemberWithRole` actually writes for a selected role:
 * admin also grants contributor (the API's write check accepts only
 * contributors) and every role adds a viewer.
 */
export function rolesGrantedBy(role: BucketMemberRole): BucketMemberRole[] {
  if (role === "admin") {
    return ["admin", "contributor", "viewer"]
  }
  if (role === "contributor") {
    return ["contributor", "viewer"]
  }
  return ["viewer"]
}

export function rolesHeld(member: MemberIdentity, lists: BucketMemberLists): BucketMemberRole[] {
  const address = member.address.trim()
  const roles: BucketMemberRole[] = []

  if (address) {
    if (lists.admins.some((entry) => addressesEqual(entry, address))) {
      roles.push("admin")
    }
    if (lists.contributors.some((entry) => addressesEqual(entry, address))) {
      roles.push("contributor")
    }
  }

  // Viewers are keyed on-chain by X25519 key, so match the profile's key against
  // the viewer list — normalized on both sides, since profiles store user-entered
  // text (base64url or hex) while the chain list carries whatever was submitted.
  const memberKey = normalizeX25519ToJwkX(member.x25519Key ?? "")
  if (memberKey && lists.viewers.some((entry) => normalizeX25519ToJwkX(entry) === memberKey)) {
    roles.push("viewer")
  }

  return roles
}
