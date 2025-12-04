import type { Message, SearchResult, DrugAvailability, Drug, Pharmacy } from '@/types/drug';

// Known drugs for detection
const KNOWN_DRUGS = [
  'paracetamol', 'acetaminophen', 'tylenol',
  'amoxicillin', 'amoxil',
  'ibuprofen', 'advil', 'motrin',
  'aspirin',
  'metformin',
  'lisinopril',
  'omeprazole',
  'ciprofloxacin',
  'azithromycin',
  'amoxiclav', 'augmentin',
  'cetirizine', 'zyrtec',
  'loratadine', 'claritin',
];

// Nigerian locations
const KNOWN_LOCATIONS = [
  'ikeja', 'lekki', 'vi', 'victoria island', 'lagos', 'yaba',
  'surulere', 'ikoyi', 'ajah', 'maryland', 'gbagada', 'festac',
  'island', 'mainland'
];

// Symptom keywords
const SYMPTOM_KEYWORDS = [
  'headache', 'pain', 'fever', 'cold', 'cough', 'flu',
  'stomach', 'ache', 'hurt', 'sick', 'ill', 'infection'
];

// Medical advice keywords
const MEDICAL_ADVICE_KEYWORDS = [
  'should i take', 'what should i', 'recommend', 'prescribe',
  'diagnose', 'treatment', 'cure', 'medical advice', 'doctor'
];

interface ConversationContext {
  detectedDrug?: string;
  detectedLocation?: string;
  hasAskedForStrength?: boolean;
}

// Extract context from conversation history
function extractContext(conversationHistory: Message[]): ConversationContext {
  const context: ConversationContext = {};

  // Look through recent messages for drug and location
  const recentMessages = conversationHistory.slice(-5);

  for (const message of recentMessages) {
    const lowerContent = message.content.toLowerCase();

    // Check for drug mentions
    for (const drug of KNOWN_DRUGS) {
      if (lowerContent.includes(drug)) {
        context.detectedDrug = drug;
        break;
      }
    }

    // Check for location mentions
    for (const location of KNOWN_LOCATIONS) {
      if (lowerContent.includes(location)) {
        context.detectedLocation = location;
        break;
      }
    }

    // Check if we've asked for strength
    if (message.role === 'assistant' &&
        (lowerContent.includes('strength') || lowerContent.includes('dosage'))) {
      context.hasAskedForStrength = true;
    }
  }

  return context;
}

// Generate mock pharmacy results
function generateMockResults(drug: string, location: string): SearchResult {
  const pharmacies: Pharmacy[] = [
    {
      id: '1',
      name: 'HealthPlus Pharmacy',
      address: `12 Admiralty Way, ${location}`,
      phone: '+234 803 123 4567',
      location: location,
      distance: '0.5 km',
      rating: 4.5,
      isOpen: true,
    },
    {
      id: '2',
      name: 'MedExpress',
      address: `45 Adeola Odeku Street, ${location}`,
      phone: '+234 802 987 6543',
      location: location,
      distance: '1.2 km',
      rating: 4.2,
      isOpen: true,
    },
    {
      id: '3',
      name: 'Pharmacy One',
      address: `8 Akin Adesola Way, ${location}`,
      phone: '+234 809 456 7890',
      location: location,
      distance: '2.0 km',
      rating: 4.7,
      isOpen: false,
    },
  ];

  // Generate drug strengths based on common drugs
  const drugStrengths: Record<string, string[]> = {
    'paracetamol': ['500mg', '1000mg'],
    'ibuprofen': ['200mg', '400mg', '600mg'],
    'amoxicillin': ['250mg', '500mg'],
    'aspirin': ['75mg', '300mg'],
    'metformin': ['500mg', '850mg', '1000mg'],
  };

  const strengths = drugStrengths[drug] || ['500mg'];
  const forms = ['Tablet', 'Capsule'];

  const results: DrugAvailability[] = pharmacies.map((pharmacy, index) => {
    const drugData: Drug = {
      id: `drug-${index}`,
      name: drug.charAt(0).toUpperCase() + drug.slice(1),
      strength: strengths[index % strengths.length],
      form: forms[index % forms.length],
      manufacturer: index === 0 ? 'GlaxoSmithKline' : index === 1 ? 'Pfizer' : 'Roche',
    };

    return {
      id: `result-${index}`,
      drug: drugData,
      pharmacy,
      price: Math.floor(Math.random() * 3000) + 500, // ₦500 - ₦3500
      stockStatus: index === 2 ? 'low-stock' : 'in-stock',
      quantity: index === 2 ? 5 : Math.floor(Math.random() * 50) + 10,
      lastUpdated: new Date(),
    };
  });

  return {
    results,
    query: drug,
    location,
    totalResults: results.length,
  };
}

export async function getMockAIResponse(
  userMessage: string,
  conversationHistory: Message[]
): Promise<{ response: string; searchResults?: SearchResult }> {
  // Simulate AI thinking time (1-2 seconds)
  await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));

  const lowerMessage = userMessage.toLowerCase();
  const context = extractContext(conversationHistory);

  // Check for medical advice requests
  for (const keyword of MEDICAL_ADVICE_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return {
        response: "I can't recommend treatments or provide medical advice, but if you have a prescription or know what medication you need, I can help you find it at nearby pharmacies! What medication are you looking for?",
      };
    }
  }

  // Check if message contains both drug and location
  let drugMatch = context.detectedDrug;
  let locationMatch = context.detectedLocation;

  for (const drug of KNOWN_DRUGS) {
    if (lowerMessage.includes(drug)) {
      drugMatch = drug;
      break;
    }
  }

  for (const location of KNOWN_LOCATIONS) {
    if (lowerMessage.includes(location)) {
      locationMatch = location;
      break;
    }
  }

  // If we have both drug and location, return results
  if (drugMatch && locationMatch) {
    const searchResults = generateMockResults(drugMatch, locationMatch);
    return {
      response: `Great! I found ${searchResults.totalResults} pharmacies with ${drugMatch} in ${locationMatch}. Here are your options:`,
      searchResults,
    };
  }

  // If we have drug but no location
  if (drugMatch && !locationMatch) {
    // Check if strength/dosage info is mentioned
    const hasStrengthInfo =
      lowerMessage.match(/\d+\s*mg/) ||
      lowerMessage.includes('tablet') ||
      lowerMessage.includes('capsule') ||
      lowerMessage.includes('syrup');

    if (!context.hasAskedForStrength || hasStrengthInfo) {
      return {
        response: `I can help you find ${drugMatch}! What's your location? For example, Ikeja, Lekki, VI, or any area in Lagos.`,
      };
    } else {
      return {
        response: `What strength or form do you need? For example, 500mg tablets, or let me know if you're not sure and I can show you available options.`,
      };
    }
  }

  // If we have location but no drug
  if (locationMatch && !drugMatch) {
    return {
      response: `Got it, you're in ${locationMatch}. What medication are you looking for?`,
    };
  }

  // Check for vague symptoms
  for (const symptom of SYMPTOM_KEYWORDS) {
    if (lowerMessage.includes(symptom)) {
      if (symptom === 'headache' || symptom === 'pain') {
        return {
          response: "For pain relief, we have options like Paracetamol, Ibuprofen, or Aspirin. Which would you prefer? Or if you have a specific prescription, let me know!",
        };
      } else if (symptom === 'fever') {
        return {
          response: "For fever, common options include Paracetamol or Ibuprofen. Which one would you like to find?",
        };
      } else if (symptom === 'cold' || symptom === 'flu' || symptom === 'cough') {
        return {
          response: "For cold and flu symptoms, I can help you find medications like Paracetamol for fever, or antihistamines like Cetirizine. What specific medication do you need?",
        };
      } else {
        return {
          response: "I understand you're not feeling well. While I can't diagnose or prescribe, I can help you find specific medications if you have a prescription or know what you need. What medication are you looking for?",
        };
      }
    }
  }

  // Greetings
  if (lowerMessage.match(/^(hi|hello|hey|good morning|good afternoon|good evening)/)) {
    return {
      response: "Hello! I'm here to help you find medications at pharmacies near you. What drug are you looking for today?",
    };
  }

  // Thanks
  if (lowerMessage.match(/thank/)) {
    return {
      response: "You're welcome! Is there anything else I can help you find?",
    };
  }

  // Default fallback
  return {
    response: "I'm not sure I understood that. Could you tell me the medication name you're looking for? For example, 'I need Paracetamol in Ikeja' or 'Find Amoxicillin near me'.",
  };
}
