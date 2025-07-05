import getWeaviateClient from "../db/weaviate_client.js";
// import weaviate from "weaviate-client"
import { Filters, WeaviateGenericObject } from 'weaviate-client';
import logger from "../logger.js";
import generateQueryEmbedding from "../utils/getQueryEmbedding.js";

type SmartDriveSchema = {
    user_id: string;
    created_at: string;
    [key: string]: string
};

const collectionMap: Record<string, string> = {
    Documents: "SmartDriveDocuments",
    Images: "SmartDriveImages",
    Media: "SmartDriveMedia",
};

const queryWeaviate = async (userId: string, userQuery: string, queryCollection: string) => {

    try {
        const client = await getWeaviateClient();
        if (client) {

            const queryVector = await generateQueryEmbedding(userQuery)

            const results: WeaviateGenericObject<SmartDriveSchema>[] = [];

            let collectionsToQuery: string[] = [];

            if (queryCollection === "SmartDrive") {
                collectionsToQuery = Object.values(collectionMap);
            } else if (collectionMap[queryCollection]) {
                collectionsToQuery = [collectionMap[queryCollection]];
            } else {
                logger.warn(`Unknown collection: ${queryCollection}`);
                return [];
            }

            for (const collectionName of collectionsToQuery) {
                const collection = client.collections.get<SmartDriveSchema>(collectionName);
                const userFilter = Filters.and(
                    collection.filter.byProperty("user_id").equal(userId),
                );

                const hybridQuery = await collection.query.hybrid(userQuery, {
                    vector: queryVector,
                    alpha: 0.5,
                    limit: 5,
                    filters: userFilter,
                    returnMetadata: ['score'],
                });

                const filenameFilter = Filters.and(
                    userFilter,
                    collection.filter.byProperty('filename').like(`*${userQuery}*`)
                );
                const filenameQuery = await collection.query.fetchObjects({
                    limit: 5,
                    filters: filenameFilter,
                });

                const filteredObjects = hybridQuery.objects.filter(obj =>
                    (obj.metadata?.score ?? 0) > 0.4
                );

                const allResultsInLoop = [
                    ...(filteredObjects ?? []),
                    ...(filenameQuery.objects.map((obj) => ({ ...obj, metadata: { score: 0.8 } })) ?? []),
                ];

                results.push(...allResultsInLoop);
            }
            const finalResults = new Map<string, WeaviateGenericObject<SmartDriveSchema>>();
            for (const obj of results) {
                const existing = finalResults.get(obj.uuid);

                if (!existing || (obj.metadata?.score ?? 0) > (existing.metadata?.score ?? 0)) {
                    finalResults.set(obj.uuid, obj);
                }
            }

            const sortedResults = Array.from(finalResults.values());

            sortedResults.sort((a, b) => (b.metadata?.score ?? 0) - (a.metadata?.score ?? 0));

            logger.info(`Returning ${sortedResults.length} unique and sorted results.`);
            return sortedResults.map(obj => obj.properties);
        }
    } catch (error) {
        logger.error('An error occurred during the search operation:', error);
        return { status: 500, error: 'Search failed due to an internal error.' };
    }

}

const getRecentUploads = async (userId: string, queryCollection: string) => {

    try {
        const client = await getWeaviateClient();
        if (!client) {
            logger.error("Client not initialized");
            return;
        }

        let collectionsToQuery: string[] = [];

        if (queryCollection === "all") {
            collectionsToQuery = Object.values(collectionMap);
        } else if (collectionMap[queryCollection]) {
            collectionsToQuery = [collectionMap[queryCollection]];
        } else {
            logger.warn(`Unknown collection: ${queryCollection}`);
            return [];
        }
        const results: SmartDriveSchema[] = [];

        for (const collectionName of collectionsToQuery) {
            const collection = client.collections.get<SmartDriveSchema>(collectionName);

            const res = await collection.query.fetchObjects({
                limit: 10,
                filters: collection.filter.byProperty("user_id").equal(userId),
                sort: collection.sort.byProperty("created_at" as string, false),
            });

            results.push(...res.objects.map(obj => obj.properties as SmartDriveSchema));
        }
        return results;
    } catch (error) {
        console.error("Error in getUploads:", error);
        return [];
    }
}

const deleteWeaviateFile = async (userId: string, fileId: string | undefined, collectionToDelete: string) => {
    if (!fileId) {
        logger.error('No fileRecord Found')
        return false
    }
    try {
        const client = await getWeaviateClient()
        if (!client) {
            logger.error("client not initialized")
            return;
        }

        const collection = client.collections.get(collectionToDelete)

        const fileFilters = Filters.and(
            collection.filter.byProperty("user_id").equal(userId),
            collection.filter.byProperty("file_id").equal(fileId)
        )

        const response = await collection.query.fetchObjects({
            limit: 10,
            filters: fileFilters,
        });

        if (response.objects.length === 0) {
            logger.warn(`Object with fileId '${fileId}' not found in Weaviate collection '${collectionToDelete}'. Nothing to delete.`);
            return true;
        }

        for(const object of response.objects){
            await collection.data.deleteById(object.uuid);
            logger.info(`Deleted duplicate Weaviate object with UUID ${object.uuid} for fileId '${fileId}'`);
        }
        

        logger.info(`Successfully deleted object with fileId '${fileId}' from Weaviate collection '${collectionToDelete}'.`);
        return true;
    } catch (error) {
        logger.error(`Failed to delete object with fileId '${fileId}' from Weaviate:`, error);
        return false;
    }

}

const deleteWeaviateUser = async (userId: string) => {
    if (!userId) {
        logger.info(`${userId} not passed. Skipping deletion`)
        return;
    }
    try {
        const client = await getWeaviateClient();
        if (!client) {
            logger.error("Client not initialized");
            return;
        }

        const collectionsToQuery = Object.values(collectionMap);
        logger.info(`Deleting Weaviate data for user ${userId} from collections: ${collectionsToQuery.join(', ')}`);
        for (const collectionName of collectionsToQuery) {
            const collection = client.collections.get(collectionName);

            await collection.data.deleteMany(
                collection.filter.byProperty("user_id").equal(userId),
            );
            logger.info(`Successfully deleted data from collection "${collectionName}" for user ${userId}.`);
        }
    } catch (error) {
        logger.error(`An error occurred while deleting Weaviate data for user ${userId}: ${error}`);
        return;
    }
}
export { queryWeaviate, getRecentUploads, deleteWeaviateFile, deleteWeaviateUser };