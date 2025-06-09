import { PubSub } from '@google-cloud/pubsub';

const projectId = 'smartdrive-461502';
const topicName = 'smartdrive-data-extract';
const subscriptionName = 'smartdrive-data-extract-sub';

const pubsub = new PubSub({ projectId });

export const setupPubSub = async () => {
    try {
        const [topic] = await pubsub.createTopic(topicName);
        console.log(`✅ Topic ${topic.name} created.`);
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: number }).code === 6) {
            console.log(`ℹ️ Topic ${topicName} already exists.`);
        } else {
            console.error('❌ Failed to create topic:', err);
            throw err;
        }
    }

    try {
        const topic = pubsub.topic(topicName);
        const [subscription] = await topic.createSubscription(subscriptionName);
        console.log(`✅ Subscription ${subscription.name} created.`);
    }
    catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: number }).code === 6) {
            console.log(`ℹ️ Subscription ${subscriptionName} already exists.`);
        } else {
            console.error('❌ Failed to create subscription:', err);
            throw err;
        }
    }
};


export const publishFileMetadata = async (file: Express.Multer.File, fileUrl: string) => {
    try {
        const topic = pubsub.topic(topicName);

        const message = {
            fileUrl,
            fileName: file.originalname,
            fileType: file.mimetype,
            uploadedAt: new Date().toISOString(),
        };

        const messageId = await topic.publishMessage({ json: message });
        console.log(`📤 Published message with ID: ${messageId}`);
    }
    catch(err:unknown) {
        console.error('❌ Failed to publish message:', err);
    }
};


