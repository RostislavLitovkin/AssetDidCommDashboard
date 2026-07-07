export default defineNuxtPlugin(() => {
  const router = useRouter()

  router.beforeEach((to) => {
    // Preserve isHeaderVisible across all navigations
    if (to.query.isHeaderVisible === undefined) {
      const stored = useCookie('rxm.isHeaderVisible')
      if (stored.value === 'false') {
        to.query.isHeaderVisible = 'false'
      }
    }
  })

  router.afterEach((to) => {
    // Persist the current isHeaderVisible value to a cookie
    const value = to.query.isHeaderVisible
    const normalizedValue = Array.isArray(value) ? value[0] : value
    const cookie = useCookie('rxm.isHeaderVisible')
    if (normalizedValue === 'false') {
      cookie.value = 'false'
    } else {
      cookie.value = undefined
    }
  })
})