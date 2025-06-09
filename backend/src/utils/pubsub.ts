import { PubSub } from '@google-cloud/pubsub';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serviceKeyPath = path.join(__dirname, '../../smartdrive-service-account.json');

const projectId = 'smartdrive-461502';
const topicName = 'smartdrive-data-extract';
const subscriptionName = 'smartdrive-data-extract-sub';

const pubsub = new PubSub({ projectId, keyFilename: serviceKeyPath });

export const setupPubSub = async () => {
    try {
        const [topic] = await pubsub.createTopic(topicName);
        console.log(`✅ Topic ${topic.name} created.`);
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as {code: number}).code === 6) {
            console.log(`ℹ️ Topic ${topicName} already exists.`);
        } else {
            throw err;
        }

        try {
            const topic = pubsub.topic(topicName);
            const [subscription] = await topic.createSubscription(subscriptionName);
            console.log(`✅ Subscription ${subscription.name} created.`);
        }
        catch (err: unknown) {
            if (err instanceof Error && 'code' in err && (err as {code: number}).code === 6) {
                console.log(`ℹ️ Subscription ${subscriptionName} already exists.`);
            } else {
                throw err;
            }
        }
    }
};

// export const subscribeToMessages = () => {
//     const subscription = pubsub.subscription(subscriptionName);

//     subscription.on('message', (message) => {
//         console.log('📩 Received message:', message.data.toString());

//         // Optional: Parse JSON
//         try {
//             const parsed = JSON.parse(message.data.toString());
//             console.log('📦 Parsed Message:', parsed);
//         } catch (err: unknown) {
//             console.warn('⚠️ Could not parse message:', message.data.toString());
//         }

//         message.ack();
//     });

//     subscription.on('error', (error) => {
//         console.error('❌ Subscription error:', error);
//     });

//     console.log(`👂 Subscribed to ${subscriptionName}`);
// };


export const publishFileMetadata = async (file: Express.Multer.File, fileUrl: string) => {
    const topic = pubsub.topic(topicName);

    const message = {
        fileUrl,
        fileName: file.originalname,
        fileType: file.mimetype,
        uploadedAt: new Date().toISOString(),
    };

    const messageId = await topic.publishMessage({ json: message });
    console.log(`📤 Published message with ID: ${messageId}`);
};


