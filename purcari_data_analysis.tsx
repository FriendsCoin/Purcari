import React, { useState } from 'react';
import { Upload, TrendingUp, Clock, MapPin, Target, Sparkles, AlertCircle, CheckCircle, BarChart3, ChevronDown, ChevronUp, Info, Zap, Users, DollarSign, Code, Palette, Music, Network, Calendar } from 'lucide-react';

const DataAnalysisDashboard = () => {
  const [view, setView] = useState('upload');
  const [analysis, setAnalysis] = useState(null);
  const [recommendedProjects, setRecommendedProjects] = useState([]);
  const [selectedHypothesis, setSelectedHypothesis] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  const loadMockData = () => {
    const detections = [];
    const species = [
      { name: 'Red Fox', type: 'mammal', count: 89 },
      { name: 'Roe Deer', type: 'mammal', count: 45 },
      { name: 'European Hare', type: 'mammal', count: 67 },
      { name: 'Wild Boar', type: 'mammal', count: 23 },
      { name: 'Chouette hulotte', type: 'bird', count: 234 },
      { name: 'European Robin', type: 'bird', count: 567 },
      { name: 'Common Blackbird', type: 'bird', count: 892 },
      { name: 'Great Tit', type: 'bird', count: 1203 }
    ];

    let id = 0;
    species.forEach(sp => {
      for (let i = 0; i < sp.count; i++) {
        const monthOffset = Math.floor(i / (sp.count / 3));
        const dayOffset = i % 30;
        const hour = sp.type === 'mammal' ? (20 + Math.floor(Math.random() * 10)) % 24 : 5 + Math.floor(Math.random() * 6);
        
        detections.push({
          id: id++,
          timestamp: new Date(2025, 4 + monthOffset, 1 + dayOffset, hour, 0).toISOString(),
          species: sp.name,
          type: sp.type,
          hotspot_id: Math.floor(Math.random() * 6) + 1
        });
      }
    });

    const hourlyActivity = {};
    const speciesCounts = {};
    const typeDistribution = {};

    detections.forEach(d => {
      const hour = new Date(d.timestamp).getHours();
      hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
      speciesCounts[d.species] = (speciesCounts[d.species] || 0) + 1;
      typeDistribution[d.type] = (typeDistribution[d.type] || 0) + 1;
    });

    const sorted = Object.entries(speciesCounts).sort((a, b) => a[1] - b[1]);
    const rare = sorted.filter(([, c]) => c < 50);
    const common = sorted.filter(([, c]) => c > 500);

    const mammalHours = {};
    detections.filter(d => d.type === 'mammal').forEach(d => {
      const h = new Date(d.timestamp).getHours();
      mammalHours[h] = (mammalHours[h] || 0) + 1;
    });

    const nightHours = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
    const nightCount = nightHours.reduce((sum, h) => sum + (mammalHours[h] || 0), 0);
    const dayHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const dayCount = dayHours.reduce((sum, h) => sum + (mammalHours[h] || 0), 0);

    const hypotheses = [
      {
        id: 'h1',
        title: 'Water Proximity → Bird Diversity',
        icon: '💧',
        result: 'confirmed',
        confidence: 0.78,
        description: 'Hotspots closer to water sources exhibit significantly higher bird species diversity',
        methodology: 'Compared species richness at hotspots within 100m of water vs. those farther away',
        findings: [
          'Near water (< 100m): Average 5.2 species per hotspot',
          'Far from water (≥ 100m): Average 2.8 species per hotspot',
          'Water Source (Hotspot #3): Highest diversity with 2,103 bird detections',
          'Riparian habitats provide critical resources: drinking water, bathing, and insect abundance'
        ],
        implications: [
          'Maintain water access points throughout vineyard',
          'Create artificial water features in dry areas',
          'Protect existing streams and ponds',
          'Monitor water quality as biodiversity indicator'
        ],
        evidence: {
          avgNearWater: '5.2 species',
          avgFarWater: '2.8 species',
          difference: '+85% more diversity'
        }
      },
      {
        id: 'h2',
        title: 'Nocturnal Mammals Avoid Daytime',
        icon: '🌙',
        result: nightCount > dayCount ? 'confirmed' : 'rejected',
        confidence: nightCount / (nightCount + dayCount),
        description: 'Mammal activity peaks during nighttime hours (20:00-06:00), indicating successful adaptation to human-dominated landscapes',
        methodology: 'Analyzed temporal distribution of 224 mammal detections across 24-hour period',
        findings: [
          `Night activity (20:00-06:00): ${nightCount} detections`,
          `Day activity (06:00-20:00): ${dayCount} detections`,
          `Ratio: ${(nightCount / dayCount).toFixed(2)}:1 in favor of night`,
          'Red Fox and Wild Boar show strongest nocturnal preference',
          'European Hare active during dawn/dusk (crepuscular)'
        ],
        implications: [
          'Vineyard operations during day minimize disturbance',
          'Night-time corridor preservation critical',
          'Camera trap placement optimized for 21:00-04:00',
          'Consider "dark sky" practices to reduce light pollution'
        ],
        evidence: {
          nightActivity: `${nightCount} detections`,
          dayActivity: `${dayCount} detections`,
          ratio: `${(nightCount / dayCount).toFixed(2)}:1`
        }
      },
      {
        id: 'h3',
        title: 'May-June Migration Peak',
        icon: '📈',
        result: 'confirmed',
        confidence: 0.65,
        description: 'Bird detections peak during breeding season (May-June), consistent with migratory and resident breeding patterns',
        methodology: 'Compared monthly detection rates across May, June, July, and August',
        findings: [
          'May-June: 4,523 bird detections (57% of total)',
          'July-August: 3,417 bird detections (43% of total)',
          'Peak activity: First week of June (breeding initiation)',
          'Species richness highest in May (113 species documented)',
          'Decline in August suggests post-breeding dispersal'
        ],
        implications: [
          'Critical nesting period: minimize disturbance May-June',
          'Habitat management timing: avoid pruning/mowing in spring',
          'Future monitoring should extend into September (autumn migration)',
          'Educational tours highlight breeding season spectacle'
        ],
        evidence: {
          mayJune: '4,523 detections',
          julyAug: '3,417 detections',
          peak: 'Early June'
        }
      },
      {
        id: 'h4',
        title: 'Rare Species Prefer Forest Edge',
        icon: '🌲',
        result: 'confirmed',
        confidence: 0.71,
        description: 'Species with fewer detections (< 50) disproportionately utilize forest edge habitats (Hotspots #2, #5)',
        methodology: 'Analyzed habitat preferences of 4 rare species vs. common species distribution',
        findings: [
          'Rare species in forest habitats: 71% of detections',
          'Rare species in open habitats: 29% of detections',
          'Wild Boar (23 detections): 87% in Oak Grove/Forest Edge',
          'Roe Deer (45 detections): 78% in woodland areas',
          'Forest edge provides structural complexity and cover'
        ],
        implications: [
          'Preserve existing forest patches and hedgerows',
          'Create wildlife corridors between forest fragments',
          'Avoid clearance of edge habitats',
          'Rare species = indicators of habitat quality'
        ],
        evidence: {
          rareInForest: '71%',
          rareInOpen: '29%',
          habitats: 'Forest Edge, Oak Grove'
        }
      },
      {
        id: 'h5',
        title: 'Temporal Niche Partitioning',
        icon: '⏰',
        result: 'confirmed',
        confidence: 0.58,
        description: 'Predator-prey pairs (Fox-Hare) show temporal separation, reducing direct encounters',
        methodology: 'Compared peak activity hours of Red Fox (predator) vs. European Hare (prey)',
        findings: [
          'Red Fox peak: 22:00-02:00 (late night)',
          'European Hare peak: 05:00-07:00 (early morning)',
          'Temporal separation: ~5 hours',
          'Only 12% overlap in activity windows',
          'Suggests behavioral adaptation to reduce predation risk'
        ],
        implications: [
          'Ecosystem functioning: predator-prey dynamics intact',
          'Habitat complexity allows coexistence',
          'Monitoring both species tracks ecosystem health',
          'Educational value: illustrate ecological interactions'
        ],
        evidence: {
          foxPeak: '22:00-02:00',
          harePeak: '05:00-07:00',
          separation: '5 hours'
        }
      }
    ];

    const projects = [
      {
        id: 1,
        name: 'The Living Clock',
        icon: '🕐',
        score: 18,
        color: 'from-blue-600 to-cyan-600',
        tagline: 'Experience biodiversity across 24 hours',
        description: 'A large-scale circular visualization that transforms 24 hours of biodiversity data into an immersive, real-time experience. Visitors see the vineyard "breathing" through day and night cycles.',
        concept: 'Imagine standing in front of a 3-meter diameter circle on the wall. The outer ring represents 24 hours. As you watch, pulses of light travel around the circle - each pulse is a real animal detection. Blue pulses = birds, orange = mammals, purple = bats. The intensity changes: morning explodes with bird activity, night glows with mammalian movement.',
        technicalStack: [
          { tech: 'TouchDesigner', purpose: 'Real-time rendering and animation engine' },
          { tech: 'Circular LED display or projection', purpose: '3m diameter, 4K resolution' },
          { tech: 'Python scripts', purpose: 'Data processing from CSV to visual parameters' },
          { tech: 'Kinect v2', purpose: 'Hand gesture control (optional: visitor interaction)' },
          { tech: 'Audio system', purpose: '5.1 surround sound for spatial audio' }
        ],
        features: [
          '24 radial segments = hours of the day',
          'Pulsating rings = real-time detections replay',
          'Color coding: Blue (birds), Orange (mammals), Purple (bats)',
          'Interactive timeline: scrub through May-August data',
          'Soundscape: actual BirdNET recordings sync to visuals',
          'Day/Night mode: lighting changes with circadian rhythm',
          '"Predict" button: ML forecasts next hour activity'
        ],
        userJourney: [
          '1. Visitor approaches → motion sensor triggers "Welcome" animation',
          '2. Default view: current time highlighted, live activity pulse',
          '3. Touch any hour → zoom into that time period, hear sounds',
          '4. Gesture left/right → scrub through days (May → August)',
          '5. Double-tap center → "rewind" to dawn chorus (5am peak)',
          '6. Take photo with QR code → receive data summary via email'
        ],
        whyItWorks: [
          'Leverages strong temporal pattern detected (hourly variation 5:1 ratio)',
          'Visceral understanding: "Oh! The vineyard is ALIVE at night"',
          'Photogenic: Instagram-worthy, increases social media reach',
          'Scalable: start with static version, upgrade to real-time feed'
        ],
        implementation: {
          timeline: '8-10 weeks',
          budget: '€12,000 - €18,000',
          phases: [
            { phase: 'Phase 1 (2 weeks)', tasks: ['Data pipeline setup', 'TouchDesigner prototype', 'Visual design finalization'] },
            { phase: 'Phase 2 (3 weeks)', tasks: ['Hardware procurement', 'Audio integration', 'Gesture control programming'] },
            { phase: 'Phase 3 (2 weeks)', tasks: ['On-site installation', 'Calibration', 'Staff training'] },
            { phase: 'Phase 4 (1 week)', tasks: ['User testing', 'Bug fixes', 'Launch event'] }
          ]
        },
        roi: {
          brand: 'Unique attraction - no other winery has this',
          engagement: 'Avg. 8 min interaction time (vs. 2 min static display)',
          press: 'Design/tech media coverage worth ~€50k in PR value',
          education: 'Communicates complex ecology instantly'
        }
      },
      {
        id: 2,
        name: 'Species Network',
        icon: '🕸️',
        score: 15,
        color: 'from-purple-600 to-pink-600',
        tagline: 'Visualize the invisible web of life',
        description: 'An interactive force-directed graph where each species is a node, and connections represent co-occurrence. Pulling one species shows cascading effects through the ecosystem.',
        concept: 'Touch screen displays floating orbs (species). Tap Red Fox → lines light up connecting to European Hare (predation), Blackbird (neutral), Oak Grove (habitat). Drag the Fox node → entire network reorganizes. Remove a species → see ecosystem collapse simulation.',
        technicalStack: [
          { tech: 'React + D3.js', purpose: 'Interactive web-based visualization' },
          { tech: 'Force simulation algorithm', purpose: 'Physics-based node positioning' },
          { tech: '55" touch display', purpose: 'Capacitive multi-touch, wall-mounted' },
          { tech: 'Neo4j graph database', purpose: 'Store species relationships' },
          { tech: 'Web Audio API', purpose: 'Species-specific sounds on interaction' }
        ],
        features: [
          'Nodes = species (size = abundance, color = type)',
          'Edges = co-occurrence strength (thicker = more often together)',
          'Relationship types: Predator-Prey, Mutualistic, Competitive, Neutral',
          'Filter modes: Show only birds, only mammals, only rare species',
          '"What if?" scenarios: Remove species → see network adapt',
          'Hotspot view: Filter by location (e.g., only Water Source species)',
          'Temporal slider: Watch network evolve from May → August'
        ],
        userJourney: [
          '1. Initial view: all 126 species arranged organically',
          '2. Hover over node → species info popup + photo',
          '3. Tap node → highlight 1st-degree connections',
          '4. Double-tap → "focus mode" isolates that species subgraph',
          '5. Drag node → network physics react, nodes repel/attract',
          '6. "Remove species" button → simulation shows cascade effects',
          '7. Reset button → smooth animation back to full network'
        ],
        whyItWorks: [
          'Makes abstract "biodiversity" concept tangible',
          'Game-like interaction = high engagement',
          'Educational: shows interdependence clearly',
          'Scientifically accurate: based on real co-occurrence data'
        ],
        implementation: {
          timeline: '6-8 weeks',
          budget: '€8,000 - €12,000',
          phases: [
            { phase: 'Phase 1 (2 weeks)', tasks: ['Co-occurrence matrix calculation', 'Graph data structure design', 'D3 force simulation prototype'] },
            { phase: 'Phase 2 (2 weeks)', tasks: ['UI/UX design', 'Species info cards', 'Animation polish'] },
            { phase: 'Phase 3 (2 weeks)', tasks: ['Touch interaction optimization', 'Performance tuning (60fps)', 'Audio integration'] },
            { phase: 'Phase 4 (1 week)', tasks: ['Installation', 'Content loading', 'User testing'] }
          ]
        },
        roi: {
          brand: 'Cutting-edge tech positions Purcari as innovator',
          engagement: 'Game-like: avg. 12 min interaction',
          education: 'School groups: perfect for ecology lessons',
          scientific: 'Publishable as "public science communication" tool'
        }
      },
      {
        id: 3,
        name: 'Soundscape Timeline',
        icon: '🎵',
        score: 16,
        color: 'from-green-600 to-emerald-600',
        tagline: 'Listen to 75 days of nature in 75 seconds',
        description: 'A horizontal timeline visualization paired with spatial audio. As you walk along the timeline, you hear the compressed soundscape of each day - the vineyard becomes an orchestra.',
        concept: '10-meter long LED strip on wall represents May 29 → Aug 16. Each LED = 1 day. As visitor walks past, motion sensors trigger that day\'s audio "essence" (5-10 sec compressed version). Dawn chorus of June 3rd, cicada hum of Aug 10th.',
        technicalStack: [
          { tech: 'Ableton Live + Max/MSP', purpose: 'Audio processing and spatial mixing' },
          { tech: 'BirdNET audio library', purpose: '7,940+ bird recordings as source material' },
          { tech: 'Proximity sensors (10x)', purpose: 'Detect visitor position along timeline' },
          { tech: 'LED strip (10m, addressable)', purpose: 'WS2812B, synchronized with audio' },
          { tech: 'Multi-speaker array', purpose: '10 speakers (1 per meter) for spatial audio' }
        ],
        features: [
          'Visual: Spectrogram-style LED animation (color = frequency)',
          'Audio: Time-compressed recordings (1 day = 10 seconds)',
          'Interactive: Walk speed controls playback rate',
          'Layers: Toggle bird/mammal/insect soundscapes',
          'Seasonal arc: Hear migration patterns (May bustle → Aug calm)',
          'Export: Record your walk → download custom mixtape',
          'Comparative mode: 2 visitors walk simultaneously, hear difference'
        ],
        userJourney: [
          '1. Approach timeline from May end',
          '2. First step triggers "This is May 29, 2025" voice-over',
          '3. Walk forward → LED trail follows, audio shifts (May → June)',
          '4. Pause at June 15 → hear extended version (30 sec)',
          '5. Walk backward → audio reverses (psychedelic effect)',
          '6. Reach August end → "You\'ve experienced 75 days" summary',
          '7. QR code → download your journey + species list'
        ],
        whyItWorks: [
          'Transforms data into embodied experience (movement = understanding)',
          'BirdNET recordings are unique asset - showcase them!',
          'Visceral seasonal change: May (loud) vs Aug (quiet)',
          'Memorable: "I walked through summer in 2 minutes"'
        ],
        implementation: {
          timeline: '10-12 weeks',
          budget: '€15,000 - €22,000',
          phases: [
            { phase: 'Phase 1 (3 weeks)', tasks: ['Audio collection/processing', 'Time-compression algorithm', 'Spectrogram generation'] },
            { phase: 'Phase 2 (3 weeks)', tasks: ['Sensor system design', 'LED programming', 'Spatial audio mixing'] },
            { phase: 'Phase 3 (3 weeks)', tasks: ['Installation (10m corridor needed)', 'Calibration', 'Audio tuning'] },
            { phase: 'Phase 4 (2 weeks)', tasks: ['User testing', 'Content refinement', 'Documentation'] }
          ]
        },
        roi: {
          brand: 'Artistic + scientific = premium positioning',
          engagement: 'Physical movement = memorable experience',
          press: 'Art/design publications (Dezeen, ArchDaily)',
          scientific: 'Acoustic ecology research collaboration opportunity'
        }
      },
      {
        id: 4,
        name: 'Rarity Hunt',
        icon: '🎯',
        score: 12,
        color: 'from-orange-600 to-red-600',
        tagline: 'Collect all 126 species - Pokemon Go meets biodiversity',
        description: 'Gamified mobile app + QR codes across vineyard. Scan QR → random species appears (probability = rarity). Collect them all to unlock prizes. Repeat visitors become "conservation champions".',
        concept: 'Every QR code is a "spawn point". Scan → 80% chance Common Blackbird, 15% European Hare, 5% Wild Boar. Your collection syncs to profile. Leaderboard shows top collectors. Complete sets = discounts, badges, invitations.',
        technicalStack: [
          { tech: 'React Native', purpose: 'Cross-platform mobile app (iOS/Android)' },
          { tech: 'QR code system', purpose: '6 codes (hotspots) + dynamic URLs' },
          { tech: 'Firebase', purpose: 'User profiles, collection storage, leaderboard' },
          { tech: 'AR.js', purpose: 'Optional: AR species visualization' },
          { tech: 'Push notifications', purpose: 'Alert users to rare species spawns' }
        ],
        features: [
          'Collection interface: 126 species cards (collected/uncollected)',
          'Rarity tiers: Common (80%), Uncommon (15%), Rare (4%), Legendary (1%)',
          'Species info: photo, scientific name, fun facts, Purcari locations',
          'Achievements: "Night Owl" (collect 5 nocturnal), "Birdwatcher" (20 birds)',
          'Social: Share collection progress on Instagram',
          'Leaderboard: Daily/weekly/all-time top collectors',
          'Events: "Rare species weekend" (2x spawn rates)'
        ],
        userJourney: [
          '1. Download app, create profile, see empty collection',
          '2. Walk vineyard, scan first QR at North Vineyard',
          '3. Animation: egg hatches → Common Blackbird appears!',
          '4. Read species card, swipe to add to collection',
          '5. Scan 5 more QR codes, get 3 Commons, 1 Uncommon, 1 duplicate',
          '6. Check leaderboard: rank #47 globally',
          '7. Return next month, scan same QR → different species spawns',
          '8. Complete "Mammals" set → unlock 10% wine discount'
        ],
        whyItWorks: [
          'Rarity data directly translates to game mechanics',
          'Encourages repeat visits (can\'t collect all in one day)',
          'Social sharing = free marketing',
          'Low-tech entry point (just QR codes needed)'
        ],
        implementation: {
          timeline: '8-10 weeks',
          budget: '€10,000 - €15,000',
          phases: [
            { phase: 'Phase 1 (3 weeks)', tasks: ['App UI/UX design', 'Collection database setup', 'Spawn probability algorithm'] },
            { phase: 'Phase 2 (3 weeks)', tasks: ['App development', 'QR system', 'Species content (photos, text)'] },
            { phase: 'Phase 3 (2 weeks)', tasks: ['Beta testing', 'QR code printing/installation', 'Leaderboard implementation'] },
            { phase: 'Phase 4 (1 week)', tasks: ['App Store submission', 'Launch campaign', 'Staff training'] }
          ]
        },
        roi: {
          brand: 'Younger demographic appeal (Gen Z/Millennials)',
          engagement: 'Repeat visits: avg. 3.2 visits to complete collection',
          data: 'Collect visitor analytics (which QR most popular?)',
          revenue: 'In-app purchases: "Rare species radar" €2.99'
        }
      },
      {
        id: 5,
        name: 'Temporal Layers',
        icon: '📅',
        score: 14,
        color: 'from-indigo-600 to-purple-600',
        tagline: 'Watch species flow through seasons like a murmuration',
        description: 'Large projection mapping on cellar wall. Animated particles represent individual detections. Over 5 minutes, watch 75 days compress into flowing rivers of life - species arrive, peak, depart.',
        concept: 'Wall becomes alive. May: explosion of blue particles (birds arriving). June: density peaks, swirling patterns. July: thinning starts. August: only residents remain. Each species = different movement pattern (starlings flock, foxes prowl solo).',
        technicalStack: [
          { tech: 'TouchDesigner + GLSL shaders', purpose: 'Particle system (10,000+ particles)' },
          { tech: 'Projector', purpose: '8,000 lumens, short-throw, wall-mounted' },
          { tech: 'Projection mapping', purpose: 'Align to architectural features' },
          { tech: 'Kinect depth camera', purpose: 'Visitor becomes obstacle (particles avoid)' },
          { tech: 'Ambient sensors', purpose: 'Adapt to room lighting conditions' }
        ],
        features: [
          'Particle behavior: Boids algorithm (flocking) for birds, random walk for mammals',
          'Color coding: species families have unique hues',
          'Seasonal palette: warm (May) → hot (July) → cool (August)',
          'Interactive: wave hand → particles react, scatter, regroup',
          'Milestones: "June 3: Peak breeding day" text appears',
          'Audio: generative soundscape synced to particle density',
          'Cycle: 5-min loop, then restarts with variations'
        ],
        userJourney: [
          '1. Enter cellar, wall appears dormant (pre-May)',
          '2. Animation begins: particles emerge from edges',
          '3. May: explosive growth, visitors gasp at density',
          '4. June: swirling, hypnotic patterns form',
          '5. July-August: graceful decline, elegiac mood',
          '6. Final frame: "7,940 birds, 350 mammals, 75 days"',
          '7. Visitor walks close → particles part like water',
          '8. Loop restarts, but with algorithmic variations'
        ],
        whyItWorks: [
          'Meditative, almost spiritual experience',
          'No instructions needed - pure visual impact',
          'Scalable: works on any wall size',
          'Seasonal metaphor: growth, abundance, decline, renewal'
        ],
        implementation: {
          timeline: '6-8 weeks',
          budget: '€9,000 - €14,000',
          phases: [
            { phase: 'Phase 1 (2 weeks)', tasks: ['Particle system programming', 'GLSL shader development', 'Animation choreography'] },
            { phase: 'Phase 2 (2 weeks)', tasks: ['Projection mapping calibration', 'Color grading', 'Audio composition'] },
            { phase: 'Phase 3 (2 weeks)', tasks: ['Kinect integration', 'Interactive refinement', 'Performance optimization'] },
            { phase: 'Phase 4 (1 week)', tasks: ['Installation', 'Launch event setup', 'Documentation'] }
          ]
        },
        roi: {
          brand: 'Luxury aesthetic - elevates wine tasting experience',
          engagement: 'Passive viewing, but high dwell time (5+ min)',
          press: 'Visual arts publications, video goes viral',
          versatility: 'Adapt for events, product launches'
        }
      }
    ];

    setAnalysis({
      summary: { total: detections.length, species: Object.keys(speciesCounts).length, start: new Date(2025, 4, 29), end: new Date(2025, 7, 16) },
      hourly: hourlyActivity,
      species: speciesCounts,
      types: typeDistribution,
      rare: rare,
      common: common,
      hypotheses: hypotheses
    });

    setRecommendedProjects(projects);
    setView('dashboard');
  };

  if (view === 'upload') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-8">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-12">
            <h1 className="text-6xl font-bold text-white mb-4">Purcari Biodiversity</h1>
            <h2 className="text-3xl text-purple-300 mb-6">Data Analysis Dashboard</h2>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              Analyze biodiversity monitoring data and get art project recommendations
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white bg-opacity-10 backdrop-blur-lg rounded-3xl p-8 border border-white border-opacity-20">
              <div className="text-center">
                <Upload size={64} className="text-purple-400 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-white mb-3">Upload CSV</h3>
                <p className="text-gray-300 mb-6 text-sm">From Every1Counts export</p>
                <button className="px-8 py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition">
                  Choose File
                </button>
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-600 to-teal-600 rounded-3xl p-8 border-2 border-emerald-400 cursor-pointer hover:scale-105 transition" onClick={loadMockData}>
              <div className="text-center">
                <Sparkles size={64} className="text-white mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-white mb-3">Use Simulated Data</h3>
                