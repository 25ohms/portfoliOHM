export const navigation = [
  { path: '/audio', label: 'Audio', index: '01', detail: 'Sound / Frequency' },
  { path: '/visual', label: 'Visual', index: '02', detail: 'Light / Systems' },
  { path: '/live', label: 'Live', index: '03', detail: 'Body / Space' },
  { path: '/about', label: 'About', index: '04', detail: 'Human / Machine' },
  { path: '/contact', label: 'Contact', index: '05', detail: 'Open a channel' },
]

export const socialLinks = {
  instagram: { label: 'Instagram', href: 'https://www.instagram.com/twentyfiveohms/' },
  youtube: { label: 'YouTube', href: 'https://www.youtube.com/@twentyfiveohms' },
  residentAdvisor: { label: 'Resident Advisor', href: 'https://ra.co/dj/25ohms' },
  bandcamp: { label: 'Bandcamp', href: 'https://25ohms.bandcamp.com/' },
  linktree: { label: 'Linktree', href: 'https://linktr.ee/25ohms' },
}

export const biography = [
  '25ohms is a multidisciplinary artist operating at the intersection of sound, light, and generative systems. Through TouchDesigner, he transforms high-intensity audio into evolving visual forms as part of the OHMEGA Project: a machine-born vessel reclaimed to preserve humanity. His work explores the space between man and machine through glitch-driven, synthetic aesthetics.',
  'Between jungle and techno, the only constant is tempo. As a DJ, 25ohms delivers high-energy sets rooted in Drum and Bass and Trance, blending hard-hitting rhythms with euphoric melodies. Across performances and installations, he builds systems where sound, code, and light converge into living, evolving experiences.',
]

export const portfolioSections = {
  audio: {
    title: 'Audio',
    subtitle: 'The only constant is tempo.',
    description:
      'High-intensity sound. Hard-hitting rhythms. Euphoric melodies. A space for music, mixes, and sonic experiments by 25ohms.',
    tags: 'DRUM & BASS / TRANCE / EXPERIMENTAL',
    empty: 'The audio archive is taking shape.',
    link: socialLinks.bandcamp,
    cta: 'Explore Bandcamp',
  },
  visual: {
    title: 'Visual',
    subtitle: 'Systems that become alive.',
    description:
      'Generative forms at the intersection of code and light. The OHMEGA Project explores what remains human inside the machine.',
    tags: 'GENERATIVE ART / LIGHT / GRAPHIC DESIGN',
    empty: 'Visual works will be collected here.',
    link: socialLinks.youtube,
    cta: 'Watch on YouTube',
  },
  live: {
    title: 'Live',
    subtitle: 'Energy, in shared space.',
    description:
      'DJ sets, audiovisual performances, and installations. Bringing sound, code, and light into the same room.',
    tags: 'DJ SETS / AUDIOVISUAL / INSTALLATIONS',
    empty: 'Performances and dates will be listed here.',
    link: socialLinks.residentAdvisor,
    cta: 'Visit Resident Advisor',
  },
}
