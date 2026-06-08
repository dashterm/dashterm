#!/usr/bin/env node

/**
 * Test Script for Generated Apps
 *
 * Usage:
 *   node test-app.js "Simple Counter" "Basic counter" "Create a counter with increment/decrement buttons"
 *   node test-app.js --help
 */

const [name, description, requirements] = process.argv.slice(2);

if (!name || name === '--help') {
  console.log(`
🧪 App Testing Script

Usage:
  node test-app.js "<name>" "<description>" "<requirements>"

Example:
  node test-app.js "Counter App" "A simple counter" "Create increment and decrement buttons"

This will:
  ✅ Generate TypeScript code using AI
  ✅ Test compilation with esbuild
  ✅ Validate code quality & guidelines
  ✅ Test runtime execution safety
  ✅ Provide detailed test report

Server must be running: npm run compile-server
  `);
  process.exit(0);
}

async function testApp() {
  try {
    console.log(`🧪 Testing app: ${name}`);
    console.log(`📝 Description: ${description}`);
    console.log(`📋 Requirements: ${requirements}\n`);

    const response = await fetch('http://localhost:8089/api/test-app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, requirements })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const results = await response.json();

    // Format results
    console.log(`⏰ Test completed at: ${results.timestamp}`);
    console.log(`🎯 Overall Result: ${results.overallResult.toUpperCase()}\n`);

    // Test details
    Object.entries(results.tests).forEach(([testName, test]) => {
      const status = test.status === 'passed' ? '✅' : '❌';
      console.log(`${status} ${testName.toUpperCase()}: ${test.status}`);

      if (test.details) {
        if (test.details.issues && test.details.issues.length > 0) {
          console.log(`   Issues: ${test.details.issues.join(', ')}`);
        }
        if (test.details.score) {
          console.log(`   Score: ${test.details.score}`);
        }
        if (test.details.componentName) {
          console.log(`   Component: ${test.details.componentName}`);
        }
      }
    });

    if (results.overallResult === 'passed') {
      console.log(`\n🎉 All tests passed! App is ready for deployment.`);
      process.exit(0);
    } else {
      console.log(`\n⚠️  Some tests failed. Check issues above.`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    console.log('\n💡 Make sure the compilation server is running:');
    console.log('   npm run compile-server');
    process.exit(1);
  }
}

testApp();