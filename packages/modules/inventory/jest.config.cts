const { readFileSync } = require('fs');
const config = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')); config.swcrc=false;
module.exports={displayName:'module-inventory',preset:'../../../jest.preset.js',testEnvironment:'node',transform:{'^.+\\.[tj]s$':['@swc/jest',config]},moduleFileExtensions:['ts','js'],coverageDirectory:'test-output/jest/coverage'};
