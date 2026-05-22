import { createClient } from '@/lib/supabase/server'
import PostMatchClient from './PostMatchClient'
import type { RestaurantWithDetails } from '@/lib/types'

export const revalidate = 0

export default async function PostMatchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: restaurants }, { data: profile }] = await Promise.all([
    supabase
      .from('restaurants')
      .select(`
        *,
        adder:profiles!added_by(id, nickname, avatar_url),
        dishes:restaurant_dishes(id, name, added_by),
        recommendations:restaurant_recommendations(id, user_id, recommended),
        tags:restaurant_tags(id, name, added_by)
      `)
      .order('created_at', { ascending: false }),
    user
      ? supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
  ])

  return (
    <PostMatchClient
      initialRestaurants={(restaurants ?? []) as unknown as RestaurantWithDetails[]}
      currentUserId={user?.id ?? ''}
      isAdmin={profile?.is_admin ?? false}
    />
  )
}
