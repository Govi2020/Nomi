const preferredFemaleVoiceNames = [
  /microsoft zira/i,
  /\b(samantha|aria|jenny|ava|victoria|susan|sara|karen|moira|tessa|allison|libby|sonia|natasha|hazel|heera|martha)\b/i,
  /\b(female|woman)\b/i,
  /google us english/i,
]

export function selectWarmFemaleVoice(voices: SpeechSynthesisVoice[]) {
  const englishVoices = voices.filter(voice => voice.lang.toLowerCase().startsWith('en'))
  for (const preference of preferredFemaleVoiceNames) {
    const voice = englishVoices.find(candidate => preference.test(candidate.name))
    if (voice) return voice
  }
  return englishVoices.find(voice => voice.default) ?? englishVoices[0] ?? null
}
