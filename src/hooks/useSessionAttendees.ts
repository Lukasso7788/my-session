export function useSessionAttendees(sessionId: string) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    load()
    const sub = supabase
      .channel('attendees')
      .on(
        'postgres_changes',
        { event: '*', table: 'session_attendees', filter: `session_id=eq.${sessionId}` },
        load
      )
      .subscribe()

    return () => sub.unsubscribe()
  }, [sessionId])

  async function load() {
    const { data } = await supabase
      .from('session_attendees')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId)
    setCount(data.length)
  }

  return count
}
