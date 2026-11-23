import { createContext, useContext } from 'react'
import type { Category, Profile, Restaurant, Role } from './supabase'

export interface AppState {
  profile: Profile
  restaurants: Restaurant[]
  roles: Record<string, Role>
  categories: Category[]
  reload: () => Promise<void>
}
export const AppCtx = createContext<AppState>(null as unknown as AppState)
export const useApp = () => useContext(AppCtx)

export function useRole(rid: string | undefined): Role | null {
  const { profile, roles } = useApp()
  if (profile.is_owner) return 'owner'
  return rid ? roles[rid] || null : null
}
export const canManage = (r: Role | null) => r === 'owner' || r === 'manager'

export function catName(c: Category | undefined, lang: string) {
  if (!c) return ''
  return lang === 'de' ? c.name_de : c.name_vi
}
