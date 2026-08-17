import { LocalRepository } from './LocalRepository'
import type { Repository } from './Repository'

/**
 * アプリが使う保存層はここで1回だけ決める。
 * Phase 3 で SheetRepository に差し替えるときも、変えるのはこの1行だけ。
 */
export const repository: Repository = new LocalRepository()

export type { Repository }
