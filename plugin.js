#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const k8s = require("@kubernetes/client-node");
const yaml = require('yaml');
const readline = require('readline');

async function listApps(showList = true) {
  try {
    const appsDir = path.join(__dirname, "apps");
    const appDirs = fs.readdirSync(appsDir);

    if (showList) {

      console.log("Available Applications:");
      appDirs.forEach((appDir, index) => {
        console.log(`[${index + 1}] ${appDir}`);
      });
    }
    return appDirs;
  } catch (err) {
    console.error("Error listing applications:", err);
  }
}


async function getWorkerNodeLabels() {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

    const nodesResponse = await k8sApi.listNode();

    const workerNodeLabels = [];

    nodesResponse.body.items.forEach(node => {

      const nodeName = node.metadata.name;
      const nodeLabels = node.metadata.labels;
      workerNodeLabels.push({ nodeName, nodeLabels });
    });

    return workerNodeLabels;
  } catch (err) {
    console.error('Error fetching worker node labels:', err);
    throw err;
  }
}

async function deployAppToNode(appName) {
  const rl2 = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  console.log("===========NODE LIST=============")
  const nodeList = await showListWorkers();
  rl2.question('Enter the number of the node to deploy: ', answer2 => {
    rl2.close();
    const selectedNodeIndex = parseInt(answer2, 10);
    if (!isNaN(selectedNodeIndex) && selectedNodeIndex > 0 && selectedNodeIndex <= nodeList.length) {
      const labelKey = 'kubernetes.io/hostname'
      const label = { labelKey, labelValue: nodeList[selectedNodeIndex - 1].nodeLabels[labelKey] || '' }
      deployAppByAppName(appName, label);
    } else {
      console.error('Invalid input. Exiting.');
    }
  })
}

async function deployApp(appName) {

  if (!appName) {
    console.log('No application name provided. Listing available applications:');
    const appDirs = await listApps() || [];
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Enter the number of the application to deploy: ', async (answer) => {
      rl.close();
      const selectedAppIndex = parseInt(answer, 10);
      if (!isNaN(selectedAppIndex) && selectedAppIndex > 0 && selectedAppIndex <= appDirs.length) {
        const appNameToDeploy = appDirs[selectedAppIndex - 1]
        deployAppToNode(appNameToDeploy);
      } else {
        console.error('Invalid input. Exiting.');
      }
    });
  }
  else {
    const listApp = await listApps(false) || [];
    if (!listApp.includes(appName)) {
      console.log('No application found! Please try again');
      return
    }
    deployAppToNode(appName);
  }

}

async function deleteApp(appName) {
  if (!appName) {
    console.log('No application name provided. Listing available applications:');
    const appDirs = await listApps() || [];

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Enter the number of the application to delete: ', (answer) => {
      rl.close();
      const selectedAppIndex = parseInt(answer, 10);
      if (!isNaN(selectedAppIndex) && selectedAppIndex > 0 && selectedAppIndex <= appDirs.length) {
        deleteAppByAppName(appDirs[selectedAppIndex - 1]);
      } else {
        console.error('Invalid input. Exiting.');
      }
    });
  } else {
    deleteAppByAppName(appName);
  }
}

async function deployAppByAppName(appName, label) {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();


    const k8sApi = kc.makeApiClient(k8s.KubernetesObjectApi);
    const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);

    await deploy({ k8sApi, k8sCoreApi, appName, ...label })

  } catch (err) {
    console.error(`Error deploying application ${appName}:`, err);

  }
}

// Function to check if the resource exists
async function checkResourceExists({ resource, k8sApi }) {
  try {
    // Check if the resource exists
    await k8sApi.read(resource);
    // console.log(`${resourceType} ${resourceName} exists.`);
    return true;
  } catch (error) {
    if (error.response && error.response.statusCode === 404) {
      // console.log(`${resourceType} ${resourceName} does not exist.`);
      return false;
    } else {
      console.error('Error!');
      return false;
    }
  }
}

const deploy = async ({ k8sApi, k8sCoreApi, labelKey, labelValue, appName }) => {
  const appDir = path.join(__dirname, "apps", appName);
  const files = fs.readdirSync(appDir);


  files.forEach(async (file) => {
    const filePath = path.join(appDir, file);
    const fileContent = fs.readFileSync(filePath, 'utf8');


    try {
      const resource = yaml.parse(fileContent);

      if (labelKey && labelValue && resource.kind !== 'Service') {
        resource.spec = resource.spec || {};
        resource.spec.template = resource.spec.template || {};
        resource.spec.template.spec = resource.spec.template.spec || {};
        resource.spec.template.spec.nodeSelector = { [labelKey]: labelValue };
      }

      // Check if the resource already exists
      const resourceName = resource.metadata.name;

      // Check if the resource exists in the cluster
      const resourceExists = await checkResourceExists({ resource, k8sCoreApi, k8sApi });

      if (resourceExists) {
        console.log(`Resource from file '${file}' exists.`);
      } else {
        // Resource not found, proceed with creation
        await k8sApi.create(resource);
        console.log(`${resource.kind} ${resourceName} deployed successfully.`);
      }

    } catch (error) {
      console.error(`Error parsing YAML file ${filePath}`, error);
    }
  });
}

async function deleteAppByAppName(appName) {
  if (!appName) {
    return;
  }
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const k8sApi = kc.makeApiClient(k8s.KubernetesObjectApi);

    const appDir = path.join(__dirname, 'apps', appName);
    const files = fs.readdirSync(appDir);

    files.forEach(async file => {
      const filePath = path.join(appDir, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');

      try {
        const resource = yaml.parse(fileContent);
        // Xóa tài nguyên
        await k8sApi.delete(resource);
        console.log(`${resource.kind} ${resource.metadata.name} deleted successfully.`);
      } catch (error) {
        console.error(`Error parsing or deleting YAML file ${filePath}:`, error);
      }
    });
  } catch (err) {
    console.error(`Error deleting application ${appName}:`, err);
  }
}

const showListWorkers = async () => {
  const workerNodeLabels = await getWorkerNodeLabels();

  workerNodeLabels.forEach(({ nodeName, nodeLabels }, index) => {
    console.log(`[${index + 1}] - Node: ${nodeName}`);
    // console.log('Labels:', nodeLabels);
  });
  return workerNodeLabels;
}


const command = process.argv[2];

if (command === "list") {
  listApps();
} else if (command === "deploy") {
  const appName = process.argv[3];

  deployApp(appName);
}
else if (command === "delete") {
  const appName = process.argv[3];
  deleteApp(appName);
}
else if (command === "worker-list") {
  showListWorkers()
}
else {
  console.error('Invalid command. Use "list" to list applications or "deploy <appName>" to deploy an application.');
}
