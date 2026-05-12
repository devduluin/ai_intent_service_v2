import type { ApiHandlerFn } from '../types'
import { intentRepository } from '../repositories/intent.repository'
import { agentRepository } from '../repositories/agent.repository'

// ============================================================
// STATIC HANDLER ONLY (NO FULL INTENT OBJECT)
// ============================================================

export const greetingHandlerKey = 'handleGreeting'

export const handleGreeting: ApiHandlerFn = async (params, context) => {
  // Extract parameters and context
  const userName = (params?.name as string) || context?.attributes?.name as string || ''
  const language = (params?.language as string) || context?.attributes?.language as string || 'id'
  const showSkills = (params?.show_skills as boolean) || context?.attributes?.show_skills as boolean || false
  
  // Get current time (server time)
  const now = new Date()
  const greetingType = getGreetingType(now)
  const timeString = formatTime(now, language)

  // Get skills from database (exclude greeting and utilities)
  const agent = await agentRepository.findBySlug(context.app_name)
  const allSkills = await intentRepository.findAllActive({ agentId: agent?.id })
  const skills = getFilteredSkills(allSkills)
  
  // Check if this is first interaction (from attributes or chat_history)
  const isFirstInteraction = checkFirstInteraction(context)
  
  // Generate greeting
  let response = generateGreeting({
    greetingType,
    userName,
    language,
    isFirstInteraction,
    skillsCount: Object.keys(skills).length
  })
  
  // Add skills list if requested or on first interaction
  if ((showSkills || isFirstInteraction) && Object.keys(skills).length > 0) {
    response += `\n\n${formatSkillsList(skills, language)}`
  }
  
  return response
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Determine greeting type based on hour
 */
function getGreetingType(date: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = date.getHours()
  
  if (hour >= 5 && hour < 11) return 'morning'      // 05:00 - 10:59
  if (hour >= 11 && hour < 15) return 'afternoon'   // 11:00 - 14:59
  if (hour >= 15 && hour < 19) return 'evening'     // 15:00 - 18:59
  return 'night'                                     // 19:00 - 04:59
}

/**
 * Format time string based on language
 */
function formatTime(date: Date, language: string): string {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  
  if (language === 'id') {
    // Indonesian format: 24-hour
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }
  
  // English format: 12-hour with AM/PM
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`
}

/**
 * Check if this is first interaction based on chat_history
 */
function checkFirstInteraction(context: any): boolean {
  // Check if there's a flag in attributes
  if (context?.attributes?.isFirstInteraction === true) {
    return true
  }
  
  // Check chat history
  const chatHistory = context?.chat_history || context?.attributes?.chat_history
  if (Array.isArray(chatHistory) && chatHistory.length > 0) {
    // Get last message in chat history
    const lastMessage = chatHistory[chatHistory.length - 1]
    
    // If last message is from 'assistant', this is NOT first interaction
    // Karena assistant baru saja merespon, berarti sudah ada interaksi sebelumnya
    if (lastMessage?.role === 'assistant') {
      return false
    }
    
    // If last message is NOT from assistant (user or other role), 
    // this IS first interaction (true)
    return true
  }
  
  // No chat history or empty array
  return true
}

/**
 * Filter skills to exclude greeting and utilities
 * Convert to JSON with slug as key and description as value
 */
function getFilteredSkills(skills: any[]): Record<string, string> {
  const excludedSlugs = ['greeting', 'utilities']
  
  const filteredSkills = skills.filter(skill => 
    !excludedSlugs.includes(skill.slug) && skill.isActive !== false
  )
  
  const skillsMap: Record<string, string> = {}
  
  for (const skill of filteredSkills) {
    // Use slug as key and description as value
    skillsMap[skill.slug] = skill.description
  }
  
  return skillsMap
}

/**
 * Format skills list for display
 */
function formatSkillsList(skills: Record<string, string>, language: string): string {
  const skillsArray = Object.entries(skills)
  
  if (skillsArray.length === 0) {
    return language === 'id' 
      ? 'Saat ini belum ada kemampuan yang tersedia.'
      : 'No skills are currently available.'
  }
  
  if (language === 'id') {
    let message = '📋 **Kemampuan yang saya miliki:**\n\n'
    
    skillsArray.forEach(([slug, description], index) => {
      // Format slug to display name (e.g., "knowledge_workin" -> "Knowledge Workin")
      const displayName = slug
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      
      message += `${index + 1}. **${displayName}**\n`
      message += `   ${description}\n\n`
    })
    
    message += '💡 Anda bisa langsung bertanya, saya akan membantu menemukan solusi terbaik untuk Anda!'
    return message
    
  } else {
    let message = '📋 **Skills I have:**\n\n'
    
    skillsArray.forEach(([slug, description], index) => {
      // Format slug to display name
      const displayName = slug
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      
      message += `${index + 1}. **${displayName}**\n`
      message += `   ${description}\n\n`
    })
    
    message += '💡 Feel free to ask, I\'ll help you find the best solution!'
    return message
  }
}

/**
 * Generate greeting message with personalization
 */
function generateGreeting(options: {
  greetingType: 'morning' | 'afternoon' | 'evening' | 'night'
  userName: string
  language: string
  isFirstInteraction: boolean
  skillsCount: number
}): string {
  const { greetingType, userName, language, isFirstInteraction, skillsCount } = options
  
  // Get greeting templates
  const templates = getGreetingTemplates(language)
  const greetingText = templates[greetingType][Math.floor(Math.random() * templates[greetingType].length)]
  
  // Build response
  let response = greetingText
  
  // Add personalized name
  if (userName && userName !== 'anonymous' && userName !== 'guest' && userName !== '') {
    if (language === 'id') {
      response += ` Senang bertemu denganmu, ${userName}!`
    } else {
      response += ` Nice to meet you, ${userName}!`
    }
  }
  
  // Add skills count info for first interaction
  if (isFirstInteraction && skillsCount > 0) {
    if (language === 'id') {
      response += ` Saya memiliki ${skillsCount} kemampuan yang bisa membantu pekerjaan Anda.`
    } else {
      response += ` I have ${skillsCount} skills that can help with your work.`
    }
  }
  
  // Add helpful prompt for first interaction
  if (isFirstInteraction) {
    const prompts = getHelpfulPrompts(language)
    response += ` ${prompts[Math.floor(Math.random() * prompts.length)]}`
  } else {
    // Short follow-up for returning users
    const followUps = getFollowUpPrompts(language)
    response += ` ${followUps[Math.floor(Math.random() * followUps.length)]}`
  }
  
  return response
}

/**
 * Get greeting templates based on language
 */
function getGreetingTemplates(language: string): Record<string, string[]> {
  if (language === 'id') {
    return {
      morning: [
        'Selamat pagi!',
        'Pagi yang cerah!',
        'Selamat memulai hari! 🌅',
        'Halo, selamat pagi!'
      ],
      afternoon: [
        'Selamat siang!',
        'Selamat siang, semoga harimu menyenangkan!',
        'Halo, selamat siang!'
      ],
      evening: [
        'Selamat sore!',
        'Selamat sore, semoga harimu baik-baik saja!',
        'Halo, selamat sore!'
      ],
      night: [
        'Selamat malam!',
        'Selamat malam, istirahat yang nyaman!',
        'Halo, selamat malam!'
      ]
    }
  }
  
  // English templates (default)
  return {
    morning: [
      'Good morning! ☀️',
      'Good morning! Rise and shine!',
      'Hello, good morning! 🌅'
    ],
    afternoon: [
      'Good afternoon! 🌤️',
      'Good afternoon! Hope you\'re having a great day!',
      'Hello, good afternoon!'
    ],
    evening: [
      'Good evening! 🌇',
      'Good evening! How was your day?',
      'Hello, good evening!'
    ],
    night: [
      'Good evening! 🌙',
      'Good evening! Hope you\'re relaxing!',
      'Hello, good evening!'
    ]
  }
}

/**
 * Get helpful prompts for first interaction
 */
function getHelpfulPrompts(language: string): string[] {
  if (language === 'id') {
    return [
      'Ada yang bisa saya bantu hari ini?',
      'Apa yang ingin Anda diskusikan?',
      'Silakan sampaikan kebutuhan Anda.',
      'Saya siap membantu Anda!'
    ]
  }
  
  return [
    'How can I help you today?',
    'What would you like to discuss?',
    'Please let me know how I can assist you.',
    "I'm ready to help you!"
  ]
}

/**
 * Get follow-up prompts for returning users
 */
function getFollowUpPrompts(language: string): string[] {
  if (language === 'id') {
    return [
      'Ada yang bisa saya bantu lagi?',
      'Apa yang ingin Anda tanyakan?',
      'Silakan lanjutkan.'
    ]
  }
  
  return [
    'How can I help you further?',
    'What would you like to ask?',
    'Please go ahead.'
  ]
}