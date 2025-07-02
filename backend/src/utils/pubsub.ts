import { PubSub, Topic } from '@google-cloud/pubsub';
import logger from '../logger.js';
import { UserFile } from '../models/userFileModel.js'; // Import the IUserFile interface

const projectId = process.env.GCP_PROJECT_ID || 'smartdrive-461502';

const pubsubConfig = {
    documents: {
        topic: 'smartdrive-data-extract',
        subscription: 'smartdrive-data-extract-sub',
    },
    images: {
        topic: 'smartdrive-image-extract',
        subscription: 'smartdrive-image-extract-sub',
    },
    media: {
        topic: 'smartdrive-media-extract',
        subscription: 'smartdrive-media-extract-sub',
    },
};

const pubsub = new PubSub({ projectId });

const createTopicAndSubscription = async (topicName: string, subName: string): Promise<void> => {
    let topic: Topic;
    try {
        [topic] = await pubsub.createTopic(topicName);
        logger.info(`✅ Topic ${topic.name} created.`);
    } catch (err: any) {
        if (err.code === 6) { // 'ALREADY_EXISTS' error code
            logger.info(`ℹ️ Topic ${topicName} already exists.`);
            topic = pubsub.topic(topicName);
        } else {
            logger.error(`❌ Failed to create topic ${topicName}:`, err);
            throw err;
        }
    }

    try {
        await topic.createSubscription(subName);
        logger.info(`✅ Subscription ${subName} created.`);
    } catch (err: any) {
        if (err.code === 6) {
            logger.info(`ℹ️ Subscription ${subName} already exists.`);
        } else {
            logger.error(`❌ Failed to create subscription ${subName}:`, err);
            throw err;
        }
    }
}

export const setupPubSub = async () => {
    logger.info("Setting up Pub/Sub topics and subscriptions...");
    for (const config of Object.values(pubsubConfig)) {
        await createTopicAndSubscription(config.topic, config.subscription);
    }
    logger.info("Pub/Sub setup complete.");
};

export const publishFileMetadata = async (fileInfo: UserFile) => {
    try {
        let topicNameToSend: string;
        const fileType = fileInfo.fileType;

        if (fileType.startsWith('image/')) {
            topicNameToSend = pubsubConfig.images.topic;
        } else if (fileType.startsWith('video/') || fileType.startsWith('audio/')) {
            topicNameToSend = pubsubConfig.media.topic;
        } else {
            topicNameToSend = pubsubConfig.documents.topic;
        }

        const topic = pubsub.topic(topicNameToSend);

        const messagePayload = {
            _id: fileInfo._id.toString(),
            userId: fileInfo.userId.toString(),
            fileName: fileInfo.fileName,
            fileType: fileInfo.fileType,
            gcsUrl: fileInfo.gcsUrl,
            uploadedAt: new Date().toISOString(),
        };

        logger.info('Publishing message:', messagePayload);

        const messageId = await topic.publishMessage({ json: messagePayload });
        logger.info(`📤 Published message for '${fileInfo.fileName}' to topic '${topicNameToSend}' (ID: ${messageId})`);
    } catch (err: unknown) {
        logger.error('❌ Failed to publish message:', err);
    }
};