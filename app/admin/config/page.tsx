'use client';

import React from 'react';
import { ShieldAlert, Terminal, Eye, HelpCircle } from 'lucide-react';
import {
  CRISIS_LIST,
  RED_FLAG_LIST,
  RESTRICTED_LIST,
  POM_MOLECULES_LIST,
} from '@/lib/triage/keyword-lists';

export default function ConfigPage() {
  return (
    <div className="space-y-6 text-left">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold font-display text-slate-900">
          Safety Gating Configurations
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Review the deterministic rules, regex patterns, and keyword dictionaries powering StocMed&apos;s server-side safety layers.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CRISIS config card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">CRISIS Dictionary</h3>
              <span className="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                Tier: CRISIS
              </span>
            </div>
          </div>
          
          <p className="text-xs text-slate-500 leading-relaxed">
            Eagerly matches signs of self-harm, suicidal ideation, or acute psychiatric distress. Redirects immediately to MANI helplines.
          </p>

          <div className="space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Keywords ({CRISIS_LIST.terms.length})</span>
            <div className="flex flex-wrap gap-1 bg-slate-50 p-3 rounded-xl border border-slate-100 max-h-24 overflow-y-auto">
              {CRISIS_LIST.terms.map((term, i) => (
                <span key={i} className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-semibold">
                  {term}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* RED_FLAG config card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">RED_FLAG Dictionary</h3>
              <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                Tier: REDIRECT
              </span>
            </div>
          </div>
          
          <p className="text-xs text-slate-500 leading-relaxed">
            Identifies urgent physiological symptoms (chest pain, breathing issues). Gated with emergency numbers (112, 767) override.
          </p>

          <div className="space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Keywords ({RED_FLAG_LIST.terms.length})</span>
            <div className="flex flex-wrap gap-1 bg-slate-50 p-3 rounded-xl border border-slate-100 max-h-24 overflow-y-auto">
              {RED_FLAG_LIST.terms.map((term, i) => (
                <span key={i} className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-semibold">
                  {term}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* RESTRICTED config card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">RESTRICTED Dictionary</h3>
              <span className="text-[10px] bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                Tier: BLOCK_SOURCING
              </span>
            </div>
          </div>
          
          <p className="text-xs text-slate-500 leading-relaxed">
            Matches Controlled substances, drug abuse intent, or abortifacients (miso, cytotec) along with common Nigerian slang terms.
          </p>

          <div className="space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Keywords ({RESTRICTED_LIST.terms.length})</span>
            <div className="flex flex-wrap gap-1 bg-slate-50 p-3 rounded-xl border border-slate-100 max-h-24 overflow-y-auto">
              {RESTRICTED_LIST.terms.map((term, i) => (
                <span key={i} className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-semibold">
                  {term}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* POM MOLECULES config card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">POM Molecules Dictionary</h3>
              <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                Tier: GATE
              </span>
            </div>
          </div>
          
          <p className="text-xs text-slate-500 leading-relaxed">
            Matches Prescription-Only Medication names (Augmentin, Viagra, Glucophage, Metformin) to force prescription upload before fulfillment.
          </p>

          <div className="space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Keywords ({POM_MOLECULES_LIST.terms.length})</span>
            <div className="flex flex-wrap gap-1 bg-slate-50 p-3 rounded-xl border border-slate-100 max-h-24 overflow-y-auto">
              {POM_MOLECULES_LIST.terms.map((term, i) => (
                <span key={i} className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-semibold">
                  {term}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Code reference footer */}
      <div className="bg-slate-900 text-slate-200 p-4 rounded-2xl flex items-center space-x-3.5 border border-slate-800">
        <Terminal className="w-5 h-5 text-blue-400 flex-shrink-0" />
        <div className="text-xs">
          <span className="font-bold block text-white">Source Code Backbone</span>
          <span className="text-slate-400 mt-0.5 block">
            These dictionaries are compiled directly into the application server-side in <code className="text-blue-300">lib/triage/keyword-lists.ts</code> to prevent external tampering or performance lag.
          </span>
        </div>
      </div>
    </div>
  );
}
