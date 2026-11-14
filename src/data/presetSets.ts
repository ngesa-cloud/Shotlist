import { LightingId, PromptSet } from '../types/photoshoot';

export const LIGHTING_OPTIONS: {
  id: LightingId;
  label: string;
  phrase: string;
  note: string;
}[] = [
  {
    id: 'soft-window-left',
    label: 'Soft Window Light (Left)',
    phrase: 'natural window light from the left',
    note: 'Gentle directional wrap for intimate boudoir skin texture and lace contrast.',
  },
  {
    id: 'overhead-fluorescent',
    label: 'Flat Overhead Fluorescent',
    phrase: 'fluorescent overhead lighting',
    note: 'Authentic locker-room vanity flatness; preserves candid smartphone realism.',
  },
  {
    id: 'harsh-midday-sun',
    label: 'Harsh Midday Sunlight',
    phrase: 'harsh midday sunlight creating sharp shadows',
    note: 'Crisp high-contrast street geometry; highlights concrete and denim grain.',
  },
  {
    id: 'neon-club-spill',
    label: 'Neon Club Spill',
    phrase: 'ambient magenta and cobalt neon spill lighting with dark falloff',
    note: 'Moody specular highlights across skin and glossy club surfaces.',
  },
  {
    id: 'studio-softbox',
    label: 'Studio Softbox Key',
    phrase: 'large octagonal studio softbox key light with subtle fill',
    note: 'Controlled fashion monograph falloff with clean catchlights.',
  },
  {
    id: 'golden-hour-rim',
    label: 'Golden Hour Rim',
    phrase: 'warm golden hour sunlight backlighting with subtle lens flare',
    note: 'Amber edge separation and warm skin highlight roll-off.',
  },
];

export const CAMERA_PRESETS: { value: string; label: string; focal: string }[] = [
  {
    value: 'shot on Canon EOS R5, 85mm f/1.8',
    label: 'Canon EOS R5 · 85mm f/1.8',
    focal: '85mm f/1.8',
  },
  {
    value: 'shot on iPhone 14 Pro',
    label: 'iPhone 14 Pro · 24mm f/1.8',
    focal: '24mm f/1.8',
  },
  {
    value: 'shot on a 35mm lens',
    label: '35mm Street Lens · f/2.8',
    focal: '35mm f/2.8',
  },
  {
    value: 'shot on Leica M6, 50mm f/1.4 Summilux',
    label: 'Leica M6 · 50mm f/1.4 Summilux',
    focal: '50mm f/1.4',
  },
  {
    value: 'shot on Contax T2, 38mm f/2.8',
    label: 'Contax T2 · 38mm f/2.8',
    focal: '38mm f/2.8',
  },
  {
    value: 'shot on Hasselblad 500C/M, 80mm f/2.8',
    label: 'Hasselblad 500C/M · 80mm f/2.8',
    focal: '80mm f/2.8',
  },
];

export const PRESET_SETS: PromptSet[] = [
  {
    id: 'boudoir-mirror-selfie',
    name: 'Boudoir & Mirror Selfie',
    subtitle:
      'Structured three-motif prompt architecture built around soft natural bedroom light, candid locker-room mirror framing, and high-angle pavement grit.',
    aestheticTag: 'Editorial & Candid Reference',
    scenes: [
      {
        id: 'soft-light-bedroom',
        sceneNumber: '01',
        title: 'Soft Light Bedroom',
        breakdown:
          'Early morning window light, shooting from slightly above eye level on an 85mm lens. Focus on skin texture and the contrast between black lace and warm skin tones.',
        imageUrl: '/src/assets/images/study_window_light_1794643364228.jpg',
        imageAlt: 'Soft early morning natural window light study in a quiet bedroom',
        subjectDescriptor:
          'gorgeous Black woman, medium brown skin, looking directly at the camera with a soft neutral expression',
        wardrobe:
          'wearing a black lace bralette with spaghetti straps, dark hair pulled back with a thick navy blue headband',
        environment: 'lying on a bed with grey patterned carpet visible in the background',
        poseAndFraming: 'shot from slightly above eye level, shallow depth of field',
        lightingId: 'soft-window-left',
        recommendedLightingId: 'soft-window-left',
        lightingPhrase: 'natural window light from the left',
        cameraAndLens: 'shot on Canon EOS R5, 85mm f/1.8',
        focalLengthLabel: '85mm f/1.8',
        qualityTokens: 'soft skin texture, visible pores, photorealistic, 8k, raw photo',
        negativeTokens:
          '(worst quality, low quality:1.4), airbrushed, plastic skin, deformed hands, extra fingers, missing limbs, cartoon, illustration, overexposed, blurry, watermark, text',
        skinTextureFocus: 'Visible pores & soft directional highlight wrap',
        contrastMotif: 'Black lace against warm medium brown skin',
      },
      {
        id: 'locker-room-mirror',
        sceneNumber: '02',
        title: 'Locker Room Mirror',
        breakdown:
          'Direct mirror selfie, frontal composition, flat vanity lighting. Casual gym-to-street, body-focused candid energy.',
        imageUrl: '/src/assets/images/study_mirror_fluorescent_1794643364111.jpg',
        imageAlt: 'Locker room mirror and flat overhead fluorescent lighting study',
        subjectDescriptor: 'attractive Black woman, hoop earrings, wavy dark hair',
        wardrobe: 'tan seamless bodysuit with thin straps',
        environment: 'standing in a locker room with beige walls',
        poseAndFraming:
          'full body mirror selfie, holding a silver iPhone in right hand, slight low-angle perspective',
        lightingId: 'overhead-fluorescent',
        recommendedLightingId: 'overhead-fluorescent',
        lightingPhrase: 'fluorescent overhead lighting',
        cameraAndLens: 'shot on iPhone 14 Pro',
        focalLengthLabel: '24mm f/1.8',
        qualityTokens:
          'visible skin texture, natural body proportions, photorealistic, candid, raw, 8k',
        negativeTokens:
          '(worst quality, low quality:1.4), distorted proportions, extra limbs, bad hands, missing fingers, cartoon, painting, smooth skin, airbrushed, text, watermark',
        skinTextureFocus: 'Unretouched smartphone skin tone & natural proportions',
        contrastMotif: 'Tan seamless fabric against matte beige walls',
      },
      {
        id: 'pavement-low-angle',
        sceneNumber: '03',
        title: 'Pavement Low Angle',
        breakdown:
          'High-angle down-shot looking at the floor, casual candid energy. Focus on the juxtaposition of pink fabric against textured concrete and a coiled blue cable.',
        imageUrl: '/src/assets/images/study_midday_concrete_1794643365386.jpg',
        imageAlt: 'High-angle concrete pavement study with coiled blue cable and harsh midday shadows',
        subjectDescriptor: 'Black woman, brown skin',
        wardrobe: 'wearing a pink thong and light blue denim jeans pulled down slightly',
        environment: 'lying on a textured concrete pavement, a blue cable coiled nearby',
        poseAndFraming: 'looking down at the floor, close crop',
        lightingId: 'harsh-midday-sun',
        recommendedLightingId: 'harsh-midday-sun',
        lightingPhrase: 'harsh midday sunlight creating sharp shadows',
        cameraAndLens: 'shot on a 35mm lens',
        focalLengthLabel: '35mm f/2.8',
        qualityTokens: 'high contrast, gritty texture, photorealistic, raw candid',
        negativeTokens:
          '(worst quality, low quality:1.4), extra limbs, distorted anatomy, smooth plastic skin, anime, illustration, blurry, watermark, text, bad perspective',
        skinTextureFocus: 'High-contrast midday shadow edge & gritty surface',
        contrastMotif: 'Pink fabric & washed denim against concrete & blue cable',
      },
    ],
    technicalNotes: [
      {
        id: 'note-lora',
        number: '01',
        title: 'LoRA is non-negotiable',
        summary:
          'Without a trained LoRA of your specific face and body, diffusion models fall back to a generic composite. The prompt dictates the scene; the LoRA dictates identity.',
      },
      {
        id: 'note-lighting',
        number: '02',
        title: 'Lighting dictates authenticity',
        summary:
          'Scene 1 relies on soft window light for intimacy. Scene 2 relies on flat fluorescent light for locker-room realism. Scene 3 relies on harsh midday sun for street grit. Avoid swapping them blindly.',
      },
      {
        id: 'note-cfg',
        number: '03',
        title: 'Keep CFG Scale at 7–9',
        summary:
          'Run Stable Diffusion between CFG 7 and 9. Higher values over-cook skin into plastic; lower values drop garment textures and strap geometry.',
      },
    ],
  },
  {
    id: 'neon-club-nightlife',
    name: 'Neon Club & After-Hours',
    subtitle:
      'High-ISO nocturnal energy blending colored club spill, direct on-camera flash reflections, and rain-slicked street asphalt.',
    aestheticTag: 'After-Hours Editorial',
    scenes: [
      {
        id: 'neon-corridor',
        sceneNumber: '01',
        title: 'Velvet Corridor Spill',
        breakdown:
          'Eye-level 50mm portrait framed in a narrow club hallway with alternating cyan and warm amber neon tubing.',
        imageAlt: 'Neon club corridor lighting motif',
        subjectDescriptor:
          'charismatic Black woman, warm brown skin with subtle dewy sheen, calm confident gaze',
        wardrobe: 'black satin slip top, layered silver chain necklace, sleek slicked-back hair',
        environment: 'leaning against dark acoustic paneling in an intimate club corridor',
        poseAndFraming: 'medium close-up, subtle Dutch tilt, shallow depth of field',
        lightingId: 'neon-club-spill',
        recommendedLightingId: 'neon-club-spill',
        lightingPhrase: 'ambient magenta and cobalt neon spill lighting with dark falloff',
        cameraAndLens: 'shot on Leica M6, 50mm f/1.4 Summilux',
        focalLengthLabel: '50mm f/1.4',
        qualityTokens: 'Cinestill 800T halation, film grain, realistic skin pores, raw candid',
        negativeTokens:
          '(worst quality, low quality:1.4), plastic skin, over-saturated neon glow, CGI, 3d render, extra fingers, blurry, watermark, text',
        skinTextureFocus: 'Dewy specular highlight catch on cheekbones',
        contrastMotif: 'Black satin against cobalt and amber tube spill',
      },
      {
        id: 'booth-flash',
        sceneNumber: '02',
        title: 'Direct Flash Booth',
        breakdown:
          'Point-and-shoot 35mm direct flash look inside a tufted leather club booth with sharp background falloff.',
        imageAlt: 'Direct on-camera flash booth motif',
        subjectDescriptor: 'expressive Black woman, natural curls, candid mid-laugh glance',
        wardrobe: 'fitted charcoal ribbed halter top, oversized hoop earrings',
        environment: 'seated in a deep burgundy leather booth, glassware reflections on table',
        poseAndFraming: 'three-quarter candid crop, slightly angled from across the table',
        lightingId: 'neon-club-spill',
        recommendedLightingId: 'neon-club-spill',
        lightingPhrase: 'direct on-camera 35mm flash with ambient neon background falloff',
        cameraAndLens: 'shot on Contax T2, 38mm f/2.8',
        focalLengthLabel: '38mm f/2.8',
        qualityTokens: 'hard flash shadow behind subject, authentic 35mm grain, raw snapshot',
        negativeTokens:
          '(worst quality, low quality:1.4), soft studio lighting, airbrushed, cartoon, deformed hands, extra limbs, watermark, text',
        skinTextureFocus: 'Crisp direct flash specular with dark shadow edge',
        contrastMotif: 'Charcoal rib knit against deep burgundy leather',
      },
      {
        id: 'rainy-curbside',
        sceneNumber: '03',
        title: 'Wet Asphalt Exit',
        breakdown:
          'Low curbside angle capturing wet street reflections and overhead marquee signage after hours.',
        imageAlt: 'Wet asphalt nightlife reflection motif',
        subjectDescriptor: 'Black woman, medium brown skin, looking back over shoulder',
        wardrobe: 'cropped leather moto jacket over minimalist tank, dark tailored trousers',
        environment: 'standing on rain-slicked city pavement outside a venue entrance',
        poseAndFraming: 'low-angle full-length frame, wide environmental context',
        lightingId: 'neon-club-spill',
        recommendedLightingId: 'neon-club-spill',
        lightingPhrase: 'wet pavement neon reflections and warm overhead marquee light',
        cameraAndLens: 'shot on 35mm lens',
        focalLengthLabel: '35mm f/2.0',
        qualityTokens: 'high contrast, subtle motion blur in background, photorealistic, raw photo',
        negativeTokens:
          '(worst quality, low quality:1.4), anime, smooth skin, floating feet, distorted anatomy, text, watermark',
        skinTextureFocus: 'Mixed marquee tungsten and cool rain reflection',
        contrastMotif: 'Matte leather against glossy wet asphalt',
      },
    ],
    technicalNotes: [
      {
        id: 'club-lora',
        number: '01',
        title: 'Keep LoRA weight at 0.75–0.85',
        summary:
          'Colored club lighting shifts skin luminance dramatically; keeping LoRA weight slightly moderated prevents color-cast artifacts.',
      },
      {
        id: 'club-film',
        number: '02',
        title: 'Use film-stock anchors over "neon glow"',
        summary:
          'Pairing Cinestill 800T or Contax T2 flash cues yields photographic halation instead of synthetic cyberpunk gradients.',
      },
      {
        id: 'club-cfg',
        number: '03',
        title: 'CFG Scale 6.5–8 for shadows',
        summary:
          'Night scenes crush into black quickly above CFG 9. Stay in the 6.5–8 range to preserve shadow detail in dark wardrobe.',
      },
    ],
  },
  {
    id: 'studio-editorial-monograph',
    name: 'Studio Editorial Monograph',
    subtitle:
      'Architectural cyclorama framing, medium-format skin fidelity, and sculpted single-source softbox falloff.',
    aestheticTag: 'Studio Monograph',
    scenes: [
      {
        id: 'cyclorama-key',
        sceneNumber: '01',
        title: 'Seamless Cyclorama Key',
        breakdown:
          'Clean 80mm medium-format portrait against a cool grey seamless backdrop using a single large octagonal softbox.',
        imageAlt: 'Studio cyclorama softbox lighting motif',
        subjectDescriptor:
          'poised Black woman, medium brown skin, composed direct gaze, clean natural makeup',
        wardrobe: 'structured ivory linen blazer over minimalist black knit top',
        environment: 'seamless cool grey studio cyclorama wall with soft floor gradient',
        poseAndFraming: 'waist-up editorial framing, centered symmetry',
        lightingId: 'studio-softbox',
        recommendedLightingId: 'studio-softbox',
        lightingPhrase: 'large octagonal studio softbox key light with subtle fill',
        cameraAndLens: 'shot on Hasselblad 500C/M, 80mm f/2.8',
        focalLengthLabel: '80mm f/2.8',
        qualityTokens: 'medium format clarity, natural skin pores, editorial magazine print, 8k',
        negativeTokens:
          '(worst quality, low quality:1.4), airbrushed, plastic skin, harsh flash, busy background, deformed hands, watermark, text',
        skinTextureFocus: 'Medium-format tonal graduation & fine pore fidelity',
        contrastMotif: 'Ivory linen tailoring on neutral slate grey',
      },
      {
        id: 'bentwood-chair',
        sceneNumber: '02',
        title: 'Bentwood Chair Study',
        breakdown:
          'Three-quarter seated study emphasizing sculptural posture and negative space across the frame.',
        imageAlt: 'Seated studio monograph portrait motif',
        subjectDescriptor: 'graceful Black woman, dark braided hair, relaxed downward-turned chin',
        wardrobe: 'minimalist espresso knit dress, subtle gold stud earrings',
        environment: 'seated sideways on a matte black bentwood studio chair, raw concrete floor',
        poseAndFraming: 'full-height three-quarter profile, generous negative space on left',
        lightingId: 'studio-softbox',
        recommendedLightingId: 'studio-softbox',
        lightingPhrase: 'feathered studio softbox from 45 degrees with negative fill',
        cameraAndLens: 'shot on Canon EOS R5, 85mm f/1.8',
        focalLengthLabel: '85mm f/2.8',
        qualityTokens: 'rich shadow falloff, crisp fabric weave texture, photorealistic, raw photo',
        negativeTokens:
          '(worst quality, low quality:1.4), extra limbs, bad chair geometry, smooth skin, CGI, cartoon, watermark',
        skinTextureFocus: 'Feathered 45-degree cheek highlight & negative fill',
        contrastMotif: 'Espresso knitwear against raw concrete studio floor',
      },
      {
        id: 'monochrome-crop',
        sceneNumber: '03',
        title: 'Tight Collarbone Crop',
        breakdown:
          'Intimate 85mm close crop prioritizing catchlights, hairline detail, and understated editorial restraint.',
        imageAlt: 'Close studio editorial crop motif',
        subjectDescriptor: 'Black woman, rich warm brown skin, subtle parted lips, calm eyes',
        wardrobe: 'minimalist black turtleneck collar framing jawline',
        environment: 'pure neutral charcoal backdrop, clean uninterrupted negative space',
        poseAndFraming: 'tight shoulder-up crop, eye-level camera placement',
        lightingId: 'studio-softbox',
        recommendedLightingId: 'studio-softbox',
        lightingPhrase: 'overhead clamshell studio lighting with soft silver reflector bounce',
        cameraAndLens: 'shot on Canon EOS R5, 85mm f/1.8',
        focalLengthLabel: '85mm f/2.0',
        qualityTokens: 'crisp iris catchlight, visible skin micro-texture, monograph print quality',
        negativeTokens:
          '(worst quality, low quality:1.4), wax skin, excessive retouching, distorted eyes, blurry, text, watermark',
        skinTextureFocus: 'Clamshell bounce with crisp eye catchlight',
        contrastMotif: 'Matte black collar against neutral charcoal',
      },
    ],
    technicalNotes: [
      {
        id: 'studio-negative',
        number: '01',
        title: 'Block over-retouching tokens',
        summary:
          'Studio keywords naturally bias models toward magazine airbrushing. Explicitly reinforce "visible skin micro-texture" and keep "airbrushed, wax skin" in the negative prompt.',
      },
      {
        id: 'studio-fill',
        number: '02',
        title: 'Pair softboxes with negative fill',
        summary:
          'Adding "negative fill" prevents flat commercial catalog lighting and restores editorial shadow depth.',
      },
      {
        id: 'studio-cfg',
        number: '03',
        title: 'CFG 7.0 preserves fabric weave',
        summary:
          'Linen and knitwear textures stay organic around CFG 7.0 without sharpening artifacts.',
      },
    ],
  },
  {
    id: 'outdoor-golden-hour',
    name: 'Outdoor Golden Hour',
    subtitle:
      'Late-afternoon sun rim separation, warm terracotta concrete steps, and natural wind movement on 35mm–85mm glass.',
    aestheticTag: 'Natural Light Outdoor',
    scenes: [
      {
        id: 'rooftop-rim',
        sceneNumber: '01',
        title: 'Rooftop Backlight Rim',
        breakdown:
          'Warm 5pm backlighting catching stray hair strands while keeping facial tones balanced with open sky bounce.',
        imageAlt: 'Golden hour rooftop backlight motif',
        subjectDescriptor:
          'radiant Black woman, warm medium brown skin, soft breeze lifting loose hair',
        wardrobe: 'off-white cotton poplin shirt worn open over neutral ribbed tank',
        environment: 'concrete parapet rooftop overlooking low city skyline',
        poseAndFraming: 'eye-level medium shot, subject angled three-quarters toward sun',
        lightingId: 'golden-hour-rim',
        recommendedLightingId: 'golden-hour-rim',
        lightingPhrase: 'warm golden hour sunlight backlighting with subtle lens flare',
        cameraAndLens: 'shot on Canon EOS R5, 85mm f/1.8',
        focalLengthLabel: '85mm f/1.8',
        qualityTokens: 'warm skin glow, natural hair halo, shallow depth of field, raw photo',
        negativeTokens:
          '(worst quality, low quality:1.4), blown out highlights, orange tint, plastic skin, extra fingers, watermark, text',
        skinTextureFocus: 'Open sky shadow fill with warm amber hair rim',
        contrastMotif: 'Crisp off-white poplin against muted city horizon',
      },
      {
        id: 'sunlit-steps',
        sceneNumber: '02',
        title: 'Sunlit Concrete Steps',
        breakdown:
          'Relaxed wide 35mm framing on warm stone steps with long late-afternoon diagonal shadows.',
        imageAlt: 'Golden hour concrete steps motif',
        subjectDescriptor: 'Black woman, natural shoulder-length hair, resting chin on hand',
        wardrobe: 'vintage light-wash straight denim jeans, fitted olive cropped tee',
        environment: 'seated casually on wide weathered stone steps',
        poseAndFraming: 'slightly high-angle 35mm environmental portrait',
        lightingId: 'golden-hour-rim',
        recommendedLightingId: 'golden-hour-rim',
        lightingPhrase: 'low raking golden hour side light casting long diagonal shadows',
        cameraAndLens: 'shot on 35mm lens',
        focalLengthLabel: '35mm f/2.8',
        qualityTokens: 'natural daylight color, realistic denim grain, candid editorial',
        negativeTokens:
          '(worst quality, low quality:1.4), oversaturated sunset, anime, deformed hands, missing limbs, watermark',
        skinTextureFocus: 'Warm side-raking highlight with cool sky shadow side',
        contrastMotif: 'Olive cotton and light denim on warm stone',
      },
      {
        id: 'coastal-wind',
        sceneNumber: '03',
        title: 'Coastal Wind Candid',
        breakdown:
          'Unposed motion study along dry coastal grass with open horizon and crisp 50mm rendering.',
        imageAlt: 'Coastal golden hour wind candid motif',
        subjectDescriptor: 'Black woman, brown skin, candid mid-turn smile toward camera',
        wardrobe: 'sand-colored linen wrap skirt, simple white tank top',
        environment: 'wooden boardwalk bordering tall golden coastal dune grass',
        poseAndFraming: 'waist-up candid motion frame, natural camera tilt',
        lightingId: 'golden-hour-rim',
        recommendedLightingId: 'golden-hour-rim',
        lightingPhrase: 'diffused late afternoon coastal sunlight',
        cameraAndLens: 'shot on Leica M6, 50mm f/1.4 Summilux',
        focalLengthLabel: '50mm f/2.0',
        qualityTokens: 'Kodak Portra 400 tones, authentic skin grain, candid raw photograph',
        negativeTokens:
          '(worst quality, low quality:1.4), HDR halo, artificial bokeh, smooth plastic skin, extra limbs, text',
        skinTextureFocus: 'Portra 400 warm midtone balance',
        contrastMotif: 'Sand linen and white cotton against dune grass',
      },
    ],
    technicalNotes: [
      {
        id: 'gold-hue',
        number: '01',
        title: 'Guard against orange oversaturation',
        summary:
          'Include "oversaturated sunset, orange tint" in the negative prompt so golden hour warmth stays natural on deeper brown skin tones.',
      },
      {
        id: 'gold-film',
        number: '02',
        title: 'Anchor with Kodak Portra 400',
        summary:
          'Portra 400 cues natural highlight roll-off without clipping bright white fabrics in direct sun.',
      },
      {
        id: 'gold-cfg',
        number: '03',
        title: 'CFG 7–8.5 keeps motion organic',
        summary:
          'Hair strands and fabric ripples look stiff above CFG 9; keep guidance moderate for wind movement.',
      },
    ],
  },
];
