import type { MatchGame, MatchParticipant } from '@/lib/types'

/** Games won by each team across a match. */
export function gamesWon(games: Pick<MatchGame, 'team1_score' | 'team2_score'>[]) {
  let team1 = 0, team2 = 0
  for (const g of games) {
    if (g.team1_score > g.team2_score) team1++
    else if (g.team2_score > g.team1_score) team2++
  }
  return { team1, team2 }
}

/** Match winner by games won: 1, 2, or 0 (tie / undecided). */
export function matchWinner(games: Pick<MatchGame, 'team1_score' | 'team2_score'>[]): 0 | 1 | 2 {
  const { team1, team2 } = gamesWon(games)
  if (team1 > team2) return 1
  if (team2 > team1) return 2
  return 0
}

/** "21:15, 18:21, 21:19" — games ordered by game_no. */
export function scoreLine(games: MatchGame[]): string {
  return [...games]
    .sort((a, b) => a.game_no - b.game_no)
    .map(g => `${g.team1_score}:${g.team2_score}`)
    .join(', ')
}

/** Participants of a team, recorder listed first. */
export function teamPlayers<T extends Pick<MatchParticipant, 'team' | 'is_recorder'>>(
  participants: T[],
  team: 1 | 2,
): T[] {
  return participants
    .filter(p => p.team === team)
    .sort((a, b) => Number(b.is_recorder) - Number(a.is_recorder))
}

/** Registered non-recorder participants who still need to confirm. */
export function pendingConfirmers<T extends Pick<MatchParticipant, 'is_recorder' | 'is_guest' | 'confirmed'>>(
  participants: T[],
): T[] {
  return participants.filter(p => !p.is_recorder && !p.is_guest && !p.confirmed)
}

/** Confirmation progress over registered non-recorder participants. */
export function confirmProgress(
  participants: Pick<MatchParticipant, 'is_recorder' | 'is_guest' | 'confirmed'>[],
) {
  const registered = participants.filter(p => !p.is_recorder && !p.is_guest)
  const confirmed = registered.filter(p => p.confirmed).length
  return { confirmed, total: registered.length }
}
