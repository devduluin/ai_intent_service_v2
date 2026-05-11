import type { ApiHandlerFn } from '../types'

// ============================================================
// STATIC HANDLER ONLY (NO FULL INTENT OBJECT)
// ============================================================

export const greetingHandlerKey = 'handleGreeting'

export const handleGreeting: ApiHandlerFn = async (params, context) => {
  const greetingType = (params.greeting_type as string) ?? 'umum'
  const userName = (params.name as string) ?? context?.user_id ?? ''

  const timeBasedGreetings: Record<string, string[]> = {
    pagi: ['Selamat pagi! ☀️', 'Pagi yang cerah!'],
    siang: ['Selamat siang! 🌤️', 'Siang yang hangat!'],
    malam: ['Selamat malam! 🌙', 'Malam yang tenang!'],
    umum: ['Halo! 👋', 'Hai! 😊', 'Hello!'],
  }

  const greetings = timeBasedGreetings[greetingType] ?? timeBasedGreetings.umum
  let response = greetings[Math.floor(Math.random() * greetings.length)]

  if (userName && userName !== 'anonymous') {
    response = `${response} ${userName}!`
  }

  return {
    success: true,
    message: response,
  }
}