import { PubSub, Topic, Subscription } from '@google-cloud/pubsub';
import logger from '../logger.js';

const projectId = 'smartdrive-461502';

const topics = {
    data: 'smartdrive-data-extract',
    // image: 'smartdrive-image-extract',
    media: 'smartdrive-media-extract'
};

const subscriptions = {
    data: 'smartdrive-data-extract-sub',
    // image: 'smartdrive-image-extract-sub',
    media: 'smartdrive-media-extract-sub'
};


const pubsub = new PubSub({ projectId });

export const createTopicAndSubscription = async (topicName: string, subName: string): Promise<void> => {
    let topic: Topic;
    try {

        [topic] = await pubsub.createTopic(topicName);
        logger.info(`✅ Topic ${topic.name} created.`);
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: number }).code === 6) {
            logger.info(`ℹ️ Topic ${topicName} already exists.`);
            topic = pubsub.topic(topicName);
        } else {
            logger.error(`❌ Failed to create or get topic ${topicName}:`, err);
            throw err;
        }
    }

    try {
        const [subscription] = await topic.createSubscription(subName);
        logger.info(`✅ Subscription ${subscription.name} created.`);
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: number }).code === 6) {
            logger.info(`ℹ️ Subscription ${subName} already exists.`);
        } else {
            logger.error(`❌ Failed to create subscription ${subName}:`, err);
            throw err;
        }
    }
};

export const setupPubSub = async () => {
    logger.info("Setting up Pub/Sub topics and subscriptions...");
    await createTopicAndSubscription(topics.data, subscriptions.data);
    // await createTopicAndSubscription(topics.image, subscriptions.image);
    await createTopicAndSubscription(topics.media, subscriptions.media);
    logger.info("Pub/Sub setup complete.");
};


export const publishFileMetadata = async (file: Express.Multer.File, fileUrl: string) => {
    try {
        let topicNameToSend: string;
        const fileType = file.mimetype;

        // if (fileType.startsWith('image/')) {
        //     topicNameToSend = topics.image;
        // } else 

        if (fileType.startsWith('video/') || fileType.startsWith('audio/')) {
            topicNameToSend = topics.media;
        } else {
            topicNameToSend = topics.data;
        }

        const topic = pubsub.topic(topicNameToSend);

        const message = {
            fileUrl,
            fileName: file.originalname,
            fileType: file.mimetype,
            uploadedAt: new Date().toISOString(),
        };

        const messageId = await topic.publishMessage({ json: message });
        logger.info(`📤 Published message for '${file.originalname}' to topic '${topicNameToSend}' (ID: ${messageId})`);
    } catch (err: unknown) {
        logger.error('❌ Failed to publish message:', err);
    }
};


