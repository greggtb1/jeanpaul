"""
Profil de Gregoire Linée — extrait de son CV.
Utilisé par les generators pour personnaliser chaque candidature.
"""

PROFILE = {
    "name": "Gregoire Linée",
    "email": "gregoire.linee@gmail.com",
    "phone": "(+33) 6.75.02.90.38",
    "website": "gregoire.pro",
    "location": "Paris",
    "tagline": (
        "Centrale Lille engineer. Product & Operations. "
        "Looking to join an ambitious team and help build and scale "
        "products with AI, automation and GTM."
    ),
    "languages": {
        "French": "Native",
        "English": "Proficient",
        "Spanish": "Intermediate",
    },
    "education": {
        "degree": "Engineer's Degree",
        "school": "Ecole Centrale de Lille",
        "track": "Entrepreneurship Track (with SKEMA Business School)",
    },
    "experience": [
        {
            "title": "Founder – GTM",
            "company": "Gare ta Bécane",
            "period": "2022 – Present",
            "location": "Paris",
            "description": "Marketplace B2B2C de parking moto, présente dans toute la France.",
            "bullets": [
                "Scaled to 10k+ parking spots, 10k+ users and €850k ARR at 30% margin",
                "Secured partnerships with major operators: Indigo, Zenpark, BePark, Saemes",
                "Built and launched the full platform from scratch (product, tech, ops)",
                "Led product, growth, automation and commercial development end to end",
                "Made the business profitable and autonomous with a lean team",
            ],
            "keywords": ["product", "growth", "gtm", "ops", "automation", "saas", "marketplace", "b2b2c", "partnerships"],
        },
        {
            "title": "Founder – Product Lead",
            "company": "Thrift Map",
            "period": "2025",
            "location": "Paris",
            "description": "iOS & Android app to discover thrift stores and second-hand events.",
            "bullets": [
                "Co-founded with fashion influencer @GiuliaCastellucci",
                "Built iOS and Android app with React Native / Expo",
                "Product design, development and launch",
            ],
            "keywords": ["product", "mobile", "ios", "android", "react native", "expo", "launch"],
        },
        {
            "title": "Builder – Personal Projects",
            "company": "Self",
            "period": "2025",
            "description": "Apps, tools and products exploring new ideas.",
            "bullets": [
                "Built apps, tools and products across multiple domains",
                "Portfolio available at gregoire.pro",
            ],
            "keywords": ["product", "builder", "vibe coding", "engineering"],
        },
        {
            "title": "Freelance – AI | Automation | Growth",
            "company": "Various clients",
            "period": "2025",
            "description": "AI-driven automation solutions for SMBs.",
            "bullets": [
                "Developed and implemented AI-driven automation solutions enhancing growth for clients",
                "Clients: Yeahpa, VLM Avocat, Skull King Online, TTMC Online",
            ],
            "keywords": ["ai", "automation", "growth", "revops", "no-code", "zapier", "openai"],
        },
    ],
    "skills": [
        "Growth & Go-to-Market",
        "AI & Automation",
        "Coding & Product Engineering",
        "Business Development",
        "Process & Operations Scaling",
    ],
    "tools": {
        "dev": ["Cursor", "React", "Supabase", "JavaScript", "Swift", "Expo", "HTML", "CSS", "PHP", "Xcode", "Stripe", "Mangopay"],
        "automation": ["OpenAI API", "Zapier", "Airtable", "Brevo", "Claude API"],
        "growth": ["Google Ads", "Search Console", "Ubersuggest", "Brevo"],
    },
    # Utilisé dans les lettres de motivation
    "motivation_hook": (
        "Je suis Gregoire Linée, ingénieur Centrale Lille avec 3 ans d'expérience "
        "en tant que fondateur de Gare ta Bécane, une marketplace B2B2C de parking moto "
        "profitable à €850k ARR. J'ai piloté le produit, les opérations, la croissance "
        "et les automatisations de A à Z. Mes projets perso sont sur gregoire.pro."
    ),
}
