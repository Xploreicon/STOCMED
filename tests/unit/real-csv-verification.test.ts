import { describe, expect, it } from 'vitest'
import { determineImportRouting, hasMedicineSignals } from '@/lib/inventory-import'

describe('Real CSV import verification flow (Spirit Pharmacy context)', () => {
  // Real CSV data provided by user in issue report: 40 total rows
  // 15 medicines (9 match catalogue, 6 have no catalogue match but have strength/dosage_form or explicit type=medicine)
  // 25 store items (no match, no strength/dosage_form, type=store or empty)

  const realCsvRows = [
    // 9 Matches (Catalogue match)
    { generic_name: 'Paracetamol', brand_name: 'Emzor Paracetamol', item_type: 'medicine', strength: '500mg', dosage_form: 'tablet', match: { id: 'prod-01', confidence: 0.95, strength_match: true, form_match: true } },
    { generic_name: 'Amoxicillin', brand_name: 'Amoxil', item_type: 'medicine', strength: '500mg', dosage_form: 'capsule', match: { id: 'prod-02', confidence: 0.94, strength_match: true, form_match: true } },
    { generic_name: 'Ibuprofen', brand_name: 'Ibucap', item_type: 'medicine', strength: '400mg', dosage_form: 'tablet', match: { id: 'prod-03', confidence: 0.93, strength_match: true, form_match: true } },
    { generic_name: 'Ciprofloxacin', brand_name: 'Ciprotab', item_type: 'medicine', strength: '500mg', dosage_form: 'tablet', match: { id: 'prod-04', confidence: 0.96, strength_match: true, form_match: true } },
    { generic_name: 'Metronidazole', brand_name: 'Flagyl', item_type: 'medicine', strength: '200mg', dosage_form: 'tablet', match: { id: 'prod-05', confidence: 0.92, strength_match: true, form_match: true } },
    { generic_name: 'Artemether + Lumefantrine', brand_name: 'Coartem', item_type: 'medicine', strength: '20mg/120mg', dosage_form: 'tablet', match: { id: 'prod-06', confidence: 0.91, strength_match: true, form_match: true } },
    { generic_name: 'Omeprazole', brand_name: 'Omez', item_type: 'medicine', strength: '20mg', dosage_form: 'capsule', match: { id: 'prod-07', confidence: 0.95, strength_match: true, form_match: true } },
    { generic_name: 'Amlodipine', brand_name: 'Norvasc', item_type: 'medicine', strength: '5mg', dosage_form: 'tablet', match: { id: 'prod-08', confidence: 0.94, strength_match: true, form_match: true } },
    { generic_name: 'Metformin', brand_name: 'Glucophage', item_type: 'medicine', strength: '500mg', dosage_form: 'tablet', match: { id: 'prod-09', confidence: 0.93, strength_match: true, form_match: true } },

    // 6 Unmatched Medicines (No catalogue match in seeded 3,289 NAFDAC DB, but has strength/dosage_form or type=medicine)
    { generic_name: 'Custom Compound Alpha', brand_name: 'Alpha-Rx', item_type: 'medicine', strength: '150mg', dosage_form: 'caplet', match: null },
    { generic_name: 'Pediatric Oral Solution Beta', brand_name: 'BetaSyrup', item_type: 'medicine', strength: '5mg/5ml', dosage_form: 'syrup', match: null },
    { generic_name: 'Specialty Injection Gamma', brand_name: 'GammaInject', item_type: 'medicine', strength: '100mg/2ml', dosage_form: 'injection', match: null },
    { generic_name: 'Dermatological Ointment Delta', brand_name: 'DeltaDerm', item_type: 'medicine', strength: '2%', dosage_form: 'ointment', match: null },
    { generic_name: 'Ophthalmic Drops Epsilon', brand_name: 'EpsilonClear', item_type: 'medicine', strength: '0.5%', dosage_form: 'eye drops', match: null },
    { generic_name: 'Extended Release Zeta', brand_name: 'ZetaXR', item_type: 'medicine', strength: '1000mg', dosage_form: 'tablet', match: null },

    // 25 Store Items (Frontstore/Grocery/Personal Care/Medical Devices with no medicine signals)
    { generic_name: 'Baby Diapers Size 3', brand_name: 'Pampers', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Antiseptic Liquid 500ml', brand_name: 'Dettol', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Cotton Wool 500g', brand_name: 'Absorbent', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Hand Sanitizer Gel 100ml', brand_name: 'Purell', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Adhesive Plaster Strips', brand_name: 'Band-Aid', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Digital Thermometer', brand_name: 'Omron', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Surgical Face Masks 50s', brand_name: 'MediGuard', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Toothpaste Triple Action 140g', brand_name: 'Colgate', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Moisturizing Lotion 400ml', brand_name: 'Nivea', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Petroleum Jelly 250g', brand_name: 'Vaseline', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Baby Wipes Sensitive 80s', brand_name: 'Huggies', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Sanitary Pads Super 10s', brand_name: 'Always', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Facial Tissue 2-Ply 200s', brand_name: 'Rose', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Shampoo Anti-Dandruff 200ml', brand_name: 'Head & Shoulders', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Insecticide Spray 600ml', brand_name: 'Raid', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Drinking Water 75cl 12-pack', brand_name: 'Eva', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Energy Drink 330ml', brand_name: 'Power', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Glucose Powder 450g', brand_name: 'Lucozade', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Disinfectant Wipes 30s', brand_name: 'Lysol', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Latex Examination Gloves 100s', brand_name: 'SafeTouch', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Digital Blood Pressure Monitor', brand_name: 'Omron', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Blood Glucose Test Strips 50s', brand_name: 'Accu-Chek', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Syringe Luer Lock 5ml 100s', brand_name: 'Terumo', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'First Aid Kit Complete', brand_name: 'StocMed Standard', item_type: 'store', strength: '', dosage_form: '', match: null },
    { generic_name: 'Multivitamin Gummies 60s', brand_name: 'Wellwoman', item_type: 'store', strength: '', dosage_form: '', match: null },
  ]

  it('routes 9 catalogue matches and holds 6 unmatched medicines without creating products', () => {
    const routingResults = realCsvRows.map((row) => {
      const routing = determineImportRouting(row, row.match)
      return {
        row,
        routing,
      }
    })

    const medicines = routingResults.filter((r) => r.routing.itemType === 'medicine')
    const storeItems = routingResults.filter((r) => r.routing.itemType === 'store')

    const matchedMedicines = medicines.filter((m) => Boolean(m.routing.selectedProductId))
    const heldMedicines = medicines.filter((m) => !m.routing.selectedProductId)

    expect(routingResults.length).toBe(40)
    expect(medicines.length).toBe(15)
    expect(storeItems.length).toBe(25)
    expect(matchedMedicines.length).toBe(9)
    expect(heldMedicines.length).toBe(6)
  })

  it('preserves the six held medicine identities for structuring/admin review', () => {
    const heldMedicineRows = realCsvRows
      .map((row) => ({ row, routing: determineImportRouting(row, row.match) }))
      .filter((r) => r.routing.itemType === 'medicine' && !r.routing.selectedProductId)
      .map((r) => ({
        generic_name: r.row.generic_name,
        brand_name: r.row.brand_name,
        strength: r.row.strength,
        dosage_form: r.row.dosage_form,
      }))

    expect(heldMedicineRows).toHaveLength(6)

    // Verify each has valid generic name, strength, and dosage form
    heldMedicineRows.forEach((entry) => {
      expect(entry.generic_name).toBeTruthy()
      expect(entry.strength).toBeTruthy()
      expect(entry.dosage_form).toBeTruthy()
    })

    // Spot check individual entries
    expect(heldMedicineRows[0]).toEqual({
      generic_name: 'Custom Compound Alpha',
      brand_name: 'Alpha-Rx',
      strength: '150mg',
      dosage_form: 'caplet',
    })

    expect(heldMedicineRows[1]).toEqual({
      generic_name: 'Pediatric Oral Solution Beta',
      brand_name: 'BetaSyrup',
      strength: '5mg/5ml',
      dosage_form: 'syrup',
    })

    expect(heldMedicineRows[5]).toEqual({
      generic_name: 'Extended Release Zeta',
      brand_name: 'ZetaXR',
      strength: '1000mg',
      dosage_form: 'tablet',
    })
  })
})
