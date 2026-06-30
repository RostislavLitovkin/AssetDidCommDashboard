import { ApiPromise, WsProvider } from '@polkadot/api';

async function main() {
  const provider = new WsProvider('wss://xcavate-solochain.api.onfinality.io/public-ws');
  const api = await ApiPromise.create({ provider });

  const submitCallArgs = api.tx.did.submitDidCall.meta.args;
  console.log("submitDidCall args:");
  submitCallArgs.forEach(arg => {
    console.log(`- ${arg.name.toString()}: ${arg.type.toString()}`);
  });

  const allTypes = api.registry.getKnownTypes();
  // We can't easily iterate all types if they are huge, but let's just search for the strings.
  // Actually, we can use createType on the type of the first arg.
  const didCallType = submitCallArgs[0].type.toString();
  console.log("\ndidCallType details:");
  try {
     const def = api.registry.getDefinition(didCallType);
     console.log(def);
  } catch(e) { console.log("getDefinition failed", e.message); }

  console.log("\nLooking for DidAuthorizedCallOperationWithVerificationRelationship...");
  const types = api.registry.getClasses(); // or keys
  // Let's just find anything with 'DidAuthorizedCall'
  const found = Object.keys(api.registry.getClasses()).filter(t => t.includes('DidAuthorizedCall'));
  console.log("Found types:", found);

  process.exit(0);
}

main().catch(console.error);
