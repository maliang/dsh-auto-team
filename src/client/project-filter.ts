/**
 * 项目库左栏的可见性过滤（r18 t3）。
 *
 * 用户口径：左栏只列「用过自动团队」的项目 —— 至少有过一次 run。
 * `runs === 0` 的项目整项隐藏；历史桶（`unknown === true`）同样只看 runs，
 * 0 次运行的历史桶也不显示（不能在列表里留一个空桶）。
 *
 * 这里是纯函数：不 import host、不 import React，也不做任何排序 ——
 * 入参顺序原样保留；「已知项目在前、历史桶固定末位」由调用方 `LibraryPage` 负责。
 */
import type { ProjectView } from '../shared/types.ts'

/** 过滤出至少有过一次 run（`runs > 0`）的项目，保持入参顺序。 */
export function visibleProjectsOf(list: readonly ProjectView[]): ProjectView[] {
  return list.filter((project) => project.runs > 0)
}
