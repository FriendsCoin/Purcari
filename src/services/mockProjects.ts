import type { Project } from '@/types';

export const mockProjects: Project[] = [
  {
    id: 1,
    name: 'The Living Clock',
    icon: '🕐',
    score: 18,
    color: 'from-blue-600 to-cyan-600',
    tagline: 'Experience biodiversity across 24 hours',
    description:
      'A large-scale circular visualization that transforms 24 hours of biodiversity data into an immersive, real-time experience. Visitors see the vineyard "breathing" through day and night cycles.',
    concept:
      'Imagine standing in front of a 3-meter diameter circle on the wall. The outer ring represents 24 hours. As you watch, pulses of light travel around the circle - each pulse is a real animal detection. Blue pulses = birds, orange = mammals, purple = bats. The intensity changes: morning explodes with bird activity, night glows with mammalian movement.',
    technicalStack: [
      { tech: 'TouchDesigner', purpose: 'Real-time rendering and animation engine' },
      { tech: 'Circular LED display or projection', purpose: '3m diameter, 4K resolution' },
      { tech: 'Python scripts', purpose: 'Data processing from CSV to visual parameters' },
      {
        tech: 'Kinect v2',
        purpose: 'Hand gesture control (optional: visitor interaction)',
      },
      { tech: 'Audio system', purpose: '5.1 surround sound for spatial audio' },
    ],
    features: [
      '24 radial segments = hours of the day',
      'Pulsating rings = real-time detections replay',
      'Color coding: Blue (birds), Orange (mammals), Purple (bats)',
      'Interactive timeline: scrub through May-August data',
      'Soundscape: actual BirdNET recordings sync to visuals',
      'Day/Night mode: lighting changes with circadian rhythm',
      '"Predict" button: ML forecasts next hour activity',
    ],
    userJourney: [
      '1. Visitor approaches → motion sensor triggers "Welcome" animation',
      '2. Default view: current time highlighted, live activity pulse',
      '3. Touch any hour → zoom into that time period, hear sounds',
      '4. Gesture left/right → scrub through days (May → August)',
      '5. Double-tap center → "rewind" to dawn chorus (5am peak)',
      '6. Take photo with QR code → receive data summary via email',
    ],
    whyItWorks: [
      'Leverages strong temporal pattern detected (hourly variation 5:1 ratio)',
      'Visceral understanding: "Oh! The vineyard is ALIVE at night"',
      'Photogenic: Instagram-worthy, increases social media reach',
      'Scalable: start with static version, upgrade to real-time feed',
    ],
    implementation: {
      timeline: '8-10 weeks',
      budget: '€12,000 - €18,000',
      phases: [
        {
          phase: 'Phase 1 (2 weeks)',
          tasks: [
            'Data pipeline setup',
            'TouchDesigner prototype',
            'Visual design finalization',
          ],
        },
        {
          phase: 'Phase 2 (3 weeks)',
          tasks: ['Hardware procurement', 'Audio integration', 'Gesture control programming'],
        },
        {
          phase: 'Phase 3 (2 weeks)',
          tasks: ['On-site installation', 'Calibration', 'Staff training'],
        },
        {
          phase: 'Phase 4 (1 week)',
          tasks: ['User testing', 'Bug fixes', 'Launch event'],
        },
      ],
    },
    roi: {
      brand: 'Unique attraction - no other winery has this',
      engagement: 'Avg. 8 min interaction time (vs. 2 min static display)',
      press: 'Design/tech media coverage worth ~€50k in PR value',
      education: 'Communicates complex ecology instantly',
    },
  },
  {
    id: 2,
    name: 'Species Network',
    icon: '🕸️',
    score: 15,
    color: 'from-purple-600 to-pink-600',
    tagline: 'Visualize the invisible web of life',
    description:
      'An interactive force-directed graph where each species is a node, and connections represent co-occurrence. Pulling one species shows cascading effects through the ecosystem.',
    concept:
      'Touch screen displays floating orbs (species). Tap Red Fox → lines light up connecting to European Hare (predation), Blackbird (neutral), Oak Grove (habitat). Drag the Fox node → entire network reorganizes. Remove a species → see ecosystem collapse simulation.',
    technicalStack: [
      { tech: 'React + D3.js', purpose: 'Interactive web-based visualization' },
      { tech: 'Force simulation algorithm', purpose: 'Physics-based node positioning' },
      { tech: '55" touch display', purpose: 'Capacitive multi-touch, wall-mounted' },
      { tech: 'Neo4j graph database', purpose: 'Store species relationships' },
      { tech: 'Web Audio API', purpose: 'Species-specific sounds on interaction' },
    ],
    features: [
      'Nodes = species (size = abundance, color = type)',
      'Edges = co-occurrence strength (thicker = more often together)',
      'Relationship types: Predator-Prey, Mutualistic, Competitive, Neutral',
      'Filter modes: Show only birds, only mammals, only rare species',
      '"What if?" scenarios: Remove species → see network adapt',
      'Hotspot view: Filter by location (e.g., only Water Source species)',
      'Temporal slider: Watch network evolve from May → August',
    ],
    userJourney: [
      '1. Initial view: all 126 species arranged organically',
      '2. Hover over node → species info popup + photo',
      '3. Tap node → highlight 1st-degree connections',
      '4. Double-tap → "focus mode" isolates that species subgraph',
      '5. Drag node → network physics react, nodes repel/attract',
      '6. "Remove species" button → simulation shows cascade effects',
      '7. Reset button → smooth animation back to full network',
    ],
    whyItWorks: [
      'Makes abstract "biodiversity" concept tangible',
      'Game-like interaction = high engagement',
      'Educational: shows interdependence clearly',
      'Scientifically accurate: based on real co-occurrence data',
    ],
    implementation: {
      timeline: '6-8 weeks',
      budget: '€8,000 - €12,000',
      phases: [
        {
          phase: 'Phase 1 (2 weeks)',
          tasks: [
            'Co-occurrence matrix calculation',
            'Graph data structure design',
            'D3 force simulation prototype',
          ],
        },
        {
          phase: 'Phase 2 (2 weeks)',
          tasks: ['UI/UX design', 'Species info cards', 'Animation polish'],
        },
        {
          phase: 'Phase 3 (2 weeks)',
          tasks: [
            'Touch interaction optimization',
            'Performance tuning (60fps)',
            'Audio integration',
          ],
        },
        {
          phase: 'Phase 4 (1 week)',
          tasks: ['Installation', 'Content loading', 'User testing'],
        },
      ],
    },
    roi: {
      brand: 'Cutting-edge tech positions Purcari as innovator',
      engagement: 'Game-like: avg. 12 min interaction',
      press: 'Tech media coverage: featured in digital art magazines',
      education: 'School groups: perfect for ecology lessons',
      scientific: 'Publishable as "public science communication" tool',
    },
  },
  {
    id: 3,
    name: 'Soundscape Timeline',
    icon: '🎵',
    score: 16,
    color: 'from-green-600 to-emerald-600',
    tagline: 'Listen to 75 days of nature in 75 seconds',
    description:
      'A horizontal timeline visualization paired with spatial audio. As you walk along the timeline, you hear the compressed soundscape of each day - the vineyard becomes an orchestra.',
    concept:
      '10-meter long LED strip on wall represents May 29 → Aug 16. Each LED = 1 day. As visitor walks past, motion sensors trigger that day\'s audio "essence" (5-10 sec compressed version). Dawn chorus of June 3rd, cicada hum of Aug 10th.',
    technicalStack: [
      { tech: 'Ableton Live + Max/MSP', purpose: 'Audio processing and spatial mixing' },
      {
        tech: 'BirdNET audio library',
        purpose: '7,940+ bird recordings as source material',
      },
      { tech: 'Proximity sensors (10x)', purpose: 'Detect visitor position along timeline' },
      { tech: 'LED strip (10m, addressable)', purpose: 'WS2812B, synchronized with audio' },
      {
        tech: 'Multi-speaker array',
        purpose: '10 speakers (1 per meter) for spatial audio',
      },
    ],
    features: [
      'Visual: Spectrogram-style LED animation (color = frequency)',
      'Audio: Time-compressed recordings (1 day = 10 seconds)',
      'Interactive: Walk speed controls playback rate',
      'Layers: Toggle bird/mammal/insect soundscapes',
      'Seasonal arc: Hear migration patterns (May bustle → Aug calm)',
      'Export: Record your walk → download custom mixtape',
      'Comparative mode: 2 visitors walk simultaneously, hear difference',
    ],
    userJourney: [
      '1. Approach timeline from May end',
      '2. First step triggers "This is May 29, 2025" voice-over',
      '3. Walk forward → LED trail follows, audio shifts (May → June)',
      '4. Pause at June 15 → hear extended version (30 sec)',
      '5. Walk backward → audio reverses (psychedelic effect)',
      '6. Reach August end → "You\'ve experienced 75 days" summary',
      '7. QR code → download your journey + species list',
    ],
    whyItWorks: [
      'Transforms data into embodied experience (movement = understanding)',
      'BirdNET recordings are unique asset - showcase them!',
      'Visceral seasonal change: May (loud) vs Aug (quiet)',
      'Memorable: "I walked through summer in 2 minutes"',
    ],
    implementation: {
      timeline: '10-12 weeks',
      budget: '€15,000 - €22,000',
      phases: [
        {
          phase: 'Phase 1 (3 weeks)',
          tasks: [
            'Audio collection/processing',
            'Time-compression algorithm',
            'Spectrogram generation',
          ],
        },
        {
          phase: 'Phase 2 (3 weeks)',
          tasks: ['Sensor system design', 'LED programming', 'Spatial audio mixing'],
        },
        {
          phase: 'Phase 3 (3 weeks)',
          tasks: ['Installation (10m corridor needed)', 'Calibration', 'Audio tuning'],
        },
        {
          phase: 'Phase 4 (2 weeks)',
          tasks: ['User testing', 'Content refinement', 'Documentation'],
        },
      ],
    },
    roi: {
      brand: 'Artistic + scientific = premium positioning',
      engagement: 'Physical movement = memorable experience',
      press: 'Art/design publications (Dezeen, ArchDaily)',
      scientific: 'Acoustic ecology research collaboration opportunity',
    },
  },
  {
    id: 4,
    name: 'Rarity Hunt',
    icon: '🎯',
    score: 12,
    color: 'from-orange-600 to-red-600',
    tagline: 'Collect all 126 species - Pokemon Go meets biodiversity',
    description:
      'Gamified mobile app + QR codes across vineyard. Scan QR → random species appears (probability = rarity). Collect them all to unlock prizes. Repeat visitors become "conservation champions".',
    concept:
      'Every QR code is a "spawn point". Scan → 80% chance Common Blackbird, 15% European Hare, 5% Wild Boar. Your collection syncs to profile. Leaderboard shows top collectors. Complete sets = discounts, badges, invitations.',
    technicalStack: [
      { tech: 'React Native', purpose: 'Cross-platform mobile app (iOS/Android)' },
      { tech: 'QR code system', purpose: '6 codes (hotspots) + dynamic URLs' },
      { tech: 'Firebase', purpose: 'User profiles, collection storage, leaderboard' },
      { tech: 'AR.js', purpose: 'Optional: AR species visualization' },
      { tech: 'Push notifications', purpose: 'Alert users to rare species spawns' },
    ],
    features: [
      'Collection interface: 126 species cards (collected/uncollected)',
      'Rarity tiers: Common (80%), Uncommon (15%), Rare (4%), Legendary (1%)',
      'Species info: photo, scientific name, fun facts, Purcari locations',
      'Achievements: "Night Owl" (collect 5 nocturnal), "Birdwatcher" (20 birds)',
      'Social: Share collection progress on Instagram',
      'Leaderboard: Daily/weekly/all-time top collectors',
      'Events: "Rare species weekend" (2x spawn rates)',
    ],
    userJourney: [
      '1. Download app, create profile, see empty collection',
      '2. Walk vineyard, scan first QR at North Vineyard',
      '3. Animation: egg hatches → Common Blackbird appears!',
      '4. Read species card, swipe to add to collection',
      '5. Scan 5 more QR codes, get 3 Commons, 1 Uncommon, 1 duplicate',
      '6. Check leaderboard: rank #47 globally',
      '7. Return next month, scan same QR → different species spawns',
      '8. Complete "Mammals" set → unlock 10% wine discount',
    ],
    whyItWorks: [
      'Rarity data directly translates to game mechanics',
      "Encourages repeat visits (can't collect all in one day)",
      'Social sharing = free marketing',
      'Low-tech entry point (just QR codes needed)',
    ],
    implementation: {
      timeline: '8-10 weeks',
      budget: '€10,000 - €15,000',
      phases: [
        {
          phase: 'Phase 1 (3 weeks)',
          tasks: [
            'App UI/UX design',
            'Collection database setup',
            'Spawn probability algorithm',
          ],
        },
        {
          phase: 'Phase 2 (3 weeks)',
          tasks: ['App development', 'QR system', 'Species content (photos, text)'],
        },
        {
          phase: 'Phase 3 (2 weeks)',
          tasks: [
            'Beta testing',
            'QR code printing/installation',
            'Leaderboard implementation',
          ],
        },
        {
          phase: 'Phase 4 (1 week)',
          tasks: ['App Store submission', 'Launch campaign', 'Staff training'],
        },
      ],
    },
    roi: {
      brand: 'Younger demographic appeal (Gen Z/Millennials)',
      engagement: 'Repeat visits: avg. 3.2 visits to complete collection',
      press: 'App Store features, gaming and tourism press coverage',
      data: 'Collect visitor analytics (which QR most popular?)',
      revenue: 'In-app purchases: "Rare species radar" €2.99',
    },
  },
  {
    id: 5,
    name: 'Temporal Layers',
    icon: '📅',
    score: 14,
    color: 'from-indigo-600 to-purple-600',
    tagline: 'Watch species flow through seasons like a murmuration',
    description:
      'Large projection mapping on cellar wall. Animated particles represent individual detections. Over 5 minutes, watch 75 days compress into flowing rivers of life - species arrive, peak, depart.',
    concept:
      'Wall becomes alive. May: explosion of blue particles (birds arriving). June: density peaks, swirling patterns. July: thinning starts. August: only residents remain. Each species = different movement pattern (starlings flock, foxes prowl solo).',
    technicalStack: [
      {
        tech: 'TouchDesigner + GLSL shaders',
        purpose: 'Particle system (10,000+ particles)',
      },
      { tech: 'Projector', purpose: '8,000 lumens, short-throw, wall-mounted' },
      { tech: 'Projection mapping', purpose: 'Align to architectural features' },
      {
        tech: 'Kinect depth camera',
        purpose: 'Visitor becomes obstacle (particles avoid)',
      },
      { tech: 'Ambient sensors', purpose: 'Adapt to room lighting conditions' },
    ],
    features: [
      'Particle behavior: Boids algorithm (flocking) for birds, random walk for mammals',
      'Color coding: species families have unique hues',
      'Seasonal palette: warm (May) → hot (July) → cool (August)',
      'Interactive: wave hand → particles react, scatter, regroup',
      'Milestones: "June 3: Peak breeding day" text appears',
      'Audio: generative soundscape synced to particle density',
      'Cycle: 5-min loop, then restarts with variations',
    ],
    userJourney: [
      '1. Enter cellar, wall appears dormant (pre-May)',
      '2. Animation begins: particles emerge from edges',
      '3. May: explosive growth, visitors gasp at density',
      '4. June: swirling, hypnotic patterns form',
      '5. July-August: graceful decline, elegiac mood',
      '6. Final frame: "7,940 birds, 350 mammals, 75 days"',
      '7. Visitor walks close → particles part like water',
      '8. Loop restarts, but with algorithmic variations',
    ],
    whyItWorks: [
      'Meditative, almost spiritual experience',
      'No instructions needed - pure visual impact',
      'Scalable: works on any wall size',
      'Seasonal metaphor: growth, abundance, decline, renewal',
    ],
    implementation: {
      timeline: '6-8 weeks',
      budget: '€9,000 - €14,000',
      phases: [
        {
          phase: 'Phase 1 (2 weeks)',
          tasks: [
            'Particle system programming',
            'GLSL shader development',
            'Animation choreography',
          ],
        },
        {
          phase: 'Phase 2 (2 weeks)',
          tasks: ['Projection mapping calibration', 'Color grading', 'Audio composition'],
        },
        {
          phase: 'Phase 3 (2 weeks)',
          tasks: ['Kinect integration', 'Interactive refinement', 'Performance optimization'],
        },
        {
          phase: 'Phase 4 (1 week)',
          tasks: ['Installation', 'Launch event setup', 'Documentation'],
        },
      ],
    },
    roi: {
      brand: 'Luxury aesthetic - elevates wine tasting experience',
      engagement: 'Passive viewing, but high dwell time (5+ min)',
      press: 'Visual arts publications, video goes viral',
      versatility: 'Adapt for events, product launches',
    },
  },
];
