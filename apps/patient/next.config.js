const fs = require('node:fs')
const path = require('node:path')

// Build-time evidence only; no audit code is bundled into the patient app.
class PatientModuleInventory {
  apply(compiler) {
    compiler.hooks.done.tap('PatientModuleInventory', stats => {
      const names = new Set()
      function collect(module) {
        names.add(module.identifier())
        if (module.modules) for (const nested of module.modules) collect(nested)
      }
      for (const module of stats.compilation.modules) collect(module)
      fs.mkdirSync(path.join(__dirname, '.next'), { recursive: true })
      fs.writeFileSync(path.join(__dirname, '.next/client-module-inventory.json'), JSON.stringify([...names].sort(), null, 2) + '\n')
    })
  }
}

/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Bound local build workers. The exported application has no Node server.
  experimental: { cpus: 2 },
  webpack(config, { isServer }) {
    if (!isServer) config.plugins.push(new PatientModuleInventory())
    return config
  },
}
