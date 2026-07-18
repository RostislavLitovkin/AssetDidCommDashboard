export type UserRole = "none" | "user" | "developer" | "admin"

export interface DeveloperStats {
  activeListedProperties: number
  propertyTokensSold: number
  totalSales: number
  averageSaleTime: number
}

export interface Profile {
  ss58Address: string
  nickname?: string
  firstName?: string
  lastName?: string
  email?: string
  phoneNumber?: string
  profilePicture?: string
  profileBackground?: string
  role: UserRole
  developerStats?: DeveloperStats
  accountCreatedAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface ProfileWriteInput {
  ss58Address?: string
  nickname?: string
  firstName?: string
  lastName?: string
  email?: string
  phoneNumber?: string
  profilePicture?: string
  profileBackground?: string
  role?: UserRole
}

export interface ProfileWriteResult {
  success: boolean
  message: string
  profile?: Profile
}
