import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { ShieldCheck, Package, Phone, MapPin } from 'lucide-react';

export const metadata = {
  title: 'Design System | StocMed',
};

export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background p-8 pb-20">
      <div className="max-w-5xl mx-auto space-y-16">
        
        <div>
          <h1 className="text-4xl font-display font-bold text-ink mb-2">Design System & Tokens</h1>
          <p className="text-muted-foreground">Comprehensive living reference for StocMed design tokens, inputs, buttons, and state pairs.</p>
        </div>

        {/* Colors Section */}
        <section>
          <h2 className="text-2xl font-display font-semibold mb-6 border-b pb-2">Colors</h2>
          
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-medium mb-4">Primary Brand (#0066CC HSL Scale)</h3>
              <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
                {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(weight => (
                  <div key={weight} className="space-y-2">
                    <div className={`h-12 w-full rounded-md bg-primary-${weight} border border-border shadow-sm`}></div>
                    <div className="text-xs text-muted-foreground font-mono">{weight}</div>
                  </div>
                ))}
              </div>
            </div>
            
            <div>
              <h3 className="text-lg font-medium mb-4">Semantic Tokens</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-card bg-surface border border-border">
                  <div className="text-sm font-semibold text-ink">Surface</div>
                  <div className="text-xs text-muted-foreground mt-1">bg-surface / #F0F7FF</div>
                </div>
                <div className="p-4 rounded-card bg-primary text-primary-foreground">
                  <div className="text-sm font-semibold">Primary</div>
                  <div className="text-xs opacity-90 mt-1">bg-primary / #0066CC</div>
                </div>
                <div className="p-4 rounded-card bg-card border border-border shadow-card">
                  <div className="text-sm font-semibold text-card-foreground">Card</div>
                  <div className="text-xs text-muted-foreground mt-1">bg-card / #FFFFFF</div>
                </div>
                <div className="p-4 rounded-card bg-background border border-border">
                  <div className="text-sm font-semibold text-foreground">Background</div>
                  <div className="text-xs text-muted-foreground mt-1">bg-background / #FFFFFF</div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-4">Status & Action Pairings</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-card bg-success/5 text-success border border-success/20">
                  <div className="text-sm font-semibold">Success / In-stock</div>
                  <div className="text-xs opacity-80 mt-1">Green text + 50 bg</div>
                </div>
                <div className="p-4 rounded-card bg-warning/5 text-warning border border-warning/20">
                  <div className="text-sm font-semibold">Warning / Low-stock</div>
                  <div className="text-xs opacity-80 mt-1">#FF9500 text + 50 bg</div>
                </div>
                <div className="p-4 rounded-card bg-danger/5 text-danger border border-danger/20">
                  <div className="text-sm font-semibold">Danger / Out-of-stock</div>
                  <div className="text-xs opacity-80 mt-1">#FF3B30 text + 50 bg</div>
                </div>
                <div className="p-4 rounded-card bg-primary/5 text-primary border border-primary/20">
                  <div className="text-sm font-semibold">Information</div>
                  <div className="text-xs opacity-80 mt-1">Blue text + 50 bg</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Typography Section */}
        <section>
          <h2 className="text-2xl font-display font-semibold mb-6 border-b pb-2">Typography</h2>
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Display / Headings (Source Serif 4 - warm editorial serif)</div>
              <h1 className="text-5xl font-display font-bold text-ink">Heading 1 (5xl, bold, tracking-tight)</h1>
              <h2 className="text-4xl font-display font-semibold text-ink">Heading 2 (4xl, semibold, tracking-tight)</h2>
              <h3 className="text-3xl font-display font-semibold text-ink">Heading 3 (3xl, semibold)</h3>
              <h4 className="text-2xl font-display font-medium text-ink">Heading 4 (2xl, medium)</h4>
            </div>
            
            <div className="space-y-2 pt-4">
              <div className="text-sm text-muted-foreground">Body / UI (Inter - clinical, precise)</div>
              <p className="text-lg text-ink font-body leading-relaxed">Large body text. The quick brown fox jumps over the lazy dog.</p>
              <p className="text-base text-ink font-body leading-relaxed">Regular body text. The quick brown fox jumps over the lazy dog.</p>
              <p className="text-sm text-ink font-body">Small body / UI text. The quick brown fox jumps over the lazy dog.</p>
              <p className="text-xs text-muted-foreground font-body">Caption / helper text. The quick brown fox jumps over the lazy dog.</p>
            </div>
            
            <div className="space-y-2 pt-4">
              <div className="text-sm text-muted-foreground">Data / Numbers (Inter Tabular Nums - aligned columns)</div>
              <p className="text-base font-body tabular-nums font-mono">₦123,456.78</p>
              <p className="text-base font-body tabular-nums font-mono">₦009,876.54</p>
            </div>
          </div>
        </section>

        {/* Controls and States Section */}
        <section>
          <h2 className="text-2xl font-display font-semibold mb-6 border-b pb-2">Buttons, Inputs & Controls</h2>
          <div className="space-y-8">
            
            {/* Buttons */}
            <div>
              <h3 className="text-lg font-medium mb-4">Button States</h3>
              <div className="flex flex-wrap gap-4 items-center">
                <Button variant="default">Primary CTA</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="ghost">Ghost Button</Button>
                <Button variant="link">Link Button</Button>
                <Button variant="default" disabled>Disabled State</Button>
              </div>
            </div>

            {/* Inputs & Validation */}
            <div>
              <h3 className="text-lg font-medium mb-4">Inputs & Dropdowns</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-ink">Text Input</label>
                  <Input placeholder="Enter patient name..." />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-ink">Select / Dropdown</label>
                  <Select>
                    <option>Select Option...</option>
                    <option>Lagos State</option>
                    <option>FCT Abuja</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-ink">Checkbox Input</label>
                  <div className="flex items-center gap-2 mt-3">
                    <Checkbox id="terms-ds" />
                    <span className="text-sm text-muted-foreground">Agree to health verification terms</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-danger">Validation Error State</label>
                  <Input placeholder="Invalid email..." className="border-danger focus-visible:ring-danger" />
                  <p className="text-[11px] text-danger">Please enter a valid email address.</p>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* Cards and Badges Section */}
        <section>
          <h2 className="text-2xl font-display font-semibold mb-6 border-b pb-2">Cards & Badges</h2>
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-medium mb-4">Elevation & Containers</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6">
                  <h4 className="font-semibold text-lg mb-2 text-ink">Default Clinical Card</h4>
                  <p className="text-sm text-muted-foreground">Clean border, subtle shadow for pharmacy context.</p>
                </Card>
                <Card className="p-6 hover:shadow-card-hover transition-all cursor-pointer">
                  <h4 className="font-semibold text-lg mb-2 text-ink">Hover State Card</h4>
                  <p className="text-sm text-muted-foreground">Slightly elevated shadow and interaction feedback.</p>
                </Card>
              </div>
            </div>
            
            <div>
              <h3 className="text-lg font-medium mb-4">Stock & Category Badges</h3>
              <div className="flex flex-wrap gap-3">
                <span className="px-2.5 py-0.5 rounded-badge text-xs badge-success">In Stock</span>
                <span className="px-2.5 py-0.5 rounded-badge text-xs badge-warning">Low Stock</span>
                <span className="px-2.5 py-0.5 rounded-badge text-xs badge-danger">Out of Stock</span>
                <span className="px-2.5 py-0.5 rounded-badge text-xs badge-info">Verified PCN</span>
                <span className="px-2.5 py-0.5 rounded-badge text-xs badge-neutral">Generic Alt</span>
              </div>
            </div>
          </div>
        </section>

        {/* Table Rows Section */}
        <section>
          <h2 className="text-2xl font-display font-semibold mb-6 border-b pb-2">Operational Data Table Rows</h2>
          <div className="border border-border rounded-card bg-card overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface text-ink text-xs font-semibold border-b border-border">
                  <th className="p-4">Medication Name</th>
                  <th className="p-4">Generic Ingredient</th>
                  <th className="p-4">Price</th>
                  <th className="p-4">Stock Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                <tr className="hover:bg-surface/50 transition-colors">
                  <td className="p-4 font-semibold text-ink">Amatem Softgel 80/480mg</td>
                  <td className="p-4 text-muted-foreground">Artemether / Lumefantrine</td>
                  <td className="p-4 tabular-nums font-mono text-ink">₦4,500.00</td>
                  <td className="p-4"><span className="px-2 py-0.5 rounded-badge text-xs badge-success">In Stock (120)</span></td>
                  <td className="p-4 text-right"><Button size="sm" variant="outline">Edit</Button></td>
                </tr>
                <tr className="hover:bg-surface/50 transition-colors">
                  <td className="p-4 font-semibold text-ink">Amoxil Capsules 500mg</td>
                  <td className="p-4 text-muted-foreground">Amoxicillin Trihydrate</td>
                  <td className="p-4 tabular-nums font-mono text-ink">₦2,200.00</td>
                  <td className="p-4"><span className="px-2 py-0.5 rounded-badge text-xs badge-warning">Low Stock (8)</span></td>
                  <td className="p-4 text-right"><Button size="sm" variant="outline">Edit</Button></td>
                </tr>
                <tr className="hover:bg-surface/50 transition-colors">
                  <td className="p-4 font-semibold text-ink">Panadol Extra Tablets</td>
                  <td className="p-4 text-muted-foreground">Paracetamol / Caffeine</td>
                  <td className="p-4 tabular-nums font-mono text-ink">₦1,100.00</td>
                  <td className="p-4"><span className="px-2 py-0.5 rounded-badge text-xs badge-danger">Out of Stock</span></td>
                  <td className="p-4 text-right"><Button size="sm" variant="outline">Edit</Button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  );
}
