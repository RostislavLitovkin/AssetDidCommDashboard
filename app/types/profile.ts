export interface Profile {
  ss58Address: string
  nickname: string | null
  bio: string | null
  profilePicture: string | null
  x25519Key: string | null
}

export interface ProfileInput {
  nickname: string
  bio: string
  profilePicture: string
  x25519Key: string
}