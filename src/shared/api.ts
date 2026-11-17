// T14: the daemon's methods as types only (main.ts' api table, its namespaced names: caps.ts RPC_NAMES). rpc (conn.ts)
// and the window's call (api.ts) take a Method, so a misspelled name fails the typecheck; a handler whose params are
// typed gets them checked too, when no result type is given (rpc('noteGet', { id })). import type only: nothing of the
// daemon reaches the window's bundle. A name made at run time goes through rpcAny / callAny, counted (test/docs.test.ts)
import type { Api } from '../daemon/main.ts'
import type { RPC_NAMES } from './caps.ts'

type Names = typeof RPC_NAMES
export type Method = (keyof Api | keyof Names) & string
type Flat<K extends Method> = K extends keyof Api ? K : K extends keyof Names ? Names[K] & keyof Api : never
type First<F> = F extends (p: infer P, ...a: never[]) => unknown ? P : never // a handler with none: unknown
export type ParamsOf<K extends Method> = First<Api[Flat<K>]>
export type ResultOf<K extends Method> = Awaited<ReturnType<Api[Flat<K>]>>
// staged (step two): a handler whose params are typed has its result typed too; one still taking any returns any
type IsAny<T> = 0 extends 1 & T ? true : false
export type Out<K extends Method> = IsAny<ParamsOf<K>> extends true ? any : ResultOf<K>
// a window's or a page's call: with no result type given, a typed handler's params and result checked; with one
// (call<View>('state')), the name only
export interface Call {
  <K extends Method>(method: K, params?: ParamsOf<K>): Promise<Out<K>>
  <T, K extends Method = Method>(method: K, params?: ParamsOf<K>): Promise<T>
}
